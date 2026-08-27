// ============================================================================
// DRAYMOND — Shared LLM Call Helper (provider chain with fallback)
// ============================================================================
// Provider-agnostic LLM calls. Ecosystem routing (DSH-aware):
//   Primary: OpenCode Zen free tier (https://opencode.ai/zen/v1). The free
//            model list is DATA-DRIVEN — the Keywire-synced catalog
//            (.draymond/model-routing.json, refreshed by pool-health + free
//            catalog sync) owns the current model set and the per-account
//            opencode key pool. The runtime cycles accounts (round-robin) and
//            free models (on 429/401/404) so quota spreads across every
//            account. muse-spark-1.2-contributor-free is only the bootstrap
//            default until the catalog says otherwise — never hard-married.
//   Fallback: OpenRouter free (OPENROUTER_API_KEY), then local Ollama, then
//            the funded Go tier (zen/go/v1, deepseek-v4-flash), then DeepSeek
//            direct (api.deepseek.com — PAID, no longer free) as last resort,
//            then the deterministic fallback. gpt/anthropic/gemini remain
//            available when explicitly requested.
// All OpenAI-compatible providers share one request shape; Anthropic uses the
// Messages API; Gemini uses the Google Generative Language format.
// ============================================================================

import { truncateToTokens, maxTokensForMode } from '../mathx';
import {
  resolveFallbackAsync,
  isDegraded,
  recordChainFailure,
  recordChainSuccess,
} from './fallbacks';
import type { FallbackContext } from './fallbacks';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type LLMProvider =
  | 'opencode-free'
  | 'opencode'
  | 'openrouter'
  | 'deepseek'
  | 'deepseek-direct'
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'qwen'
  | 'litellm'
  | 'dsh'
  | 'ollama';

export interface LLMCallOptions {
  /** Preferred provider. Falls back through the chain when it fails. */
  provider?: LLMProvider;
  /** Model name. Provider-specific defaults apply when omitted. */
  model?: string;
  system: string;
  userMessage: string;
  maxTokens?: number;
  /** Math X mode — when set and no maxTokens, uses the mode's token budget. */
  mode?: string;
  /** Truncate the user message to fit the token budget (opt-in). */
  truncate?: boolean;
  /** Image inputs for vision-capable providers (OCR). Base64, no data-uri prefix. */
  images?: Array<{ dataB64: string; mediaType: string }>;
  temperature?: number;
  timeoutMs?: number;
  /** Request structured JSON output (OpenAI-compatible `response_format` /
   *  Gemini `responseMimeType: application/json`). */
  responseFormat?: { type: 'json_object' };
  /** Enable a provider's native deep-reasoning mode (Anthropic `thinking`,
   *  DeepSeek `deepseek-reasoner` model, OpenAI `reasoning_effort`). */
  reasoning?: boolean;
  /** Deterministic fallback: when EVERY provider fails, return this fixed
   *  templated string instead of throwing, so pipelines never stall on a
   *  total LLM outage. Unset = keep the current throw behaviour. */
  deterministicFallback?: string;
  /** Registry key for a deterministic fallback (see ./fallbacks). When every
   *  provider fails — or the fleet is in degraded mode — the registered
   *  resolver produces the output. Prefer this over inline strings so the
   *  coverage metric and degraded-mode short-circuit both work. */
  fallbackKey?: string;
  /** Extra context passed to the registered fallback resolver. */
  fallbackContext?: FallbackContext;
  /** Re-encode structured JSON blocks (```json fences, <context>) in the
   *  system/user messages as TOON when that measurably shrinks the payload.
   *  Lossless and length-gated — never corrupts a prompt. */
  toonify?: boolean;
  /** Try the local Ollama tier FIRST (free, on-device) before any paid
   *  provider. Falls back to the paid chain when local is unreachable.
   *  Local-only functions (hiccup reporting, schedule notes, chat polish)
   *  pass this to keep token spend near zero. */
  localFirst?: boolean;
  /** Skill identifier for skill→model-tier routing (consults skill-model-map.json). */
  skillId?: string;
}

const PROVIDER_URLS: Record<LLMProvider, string> = {
  // OpenCode Zen free tier — ecosystem primary. Data-driven model + key pool
  // (see freeModelList()/opencodeKeyPool()). Routed via DSH harness when DSH is up.
  'opencode-free': 'https://opencode.ai/zen/v1/chat/completions',
  opencode: 'https://opencode.ai/zen/go/v1/chat/completions',
  // OpenRouter free (:free) models — second free tier, unlimited-ish daily quota.
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  'deepseek-direct': 'https://api.deepseek.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
  litellm: 'http://localhost:4100/v1/chat/completions',
  // Fleet gateway seam — same LiteLLM proxy as `litellm`, addressed by the
  // STABLE `fleet-free` model_group alias so callers survive daily free-model
  // rotation. NOTE: the DSH web server (:3080) exposes NO completions API — it
  // is a UI-only SPA; never point HTTP callers there. Env OPENCODE_VIA_DSH=1
  // historically preferred this; the harness value-add (persona/skills/hooks)
  // lives in the CLI session layer, not on an HTTP port.
  dsh: 'http://localhost:4100/v1/chat/completions',
  ollama: 'http://localhost:11434/v1/chat/completions',
};

const PROVIDER_ENV: Record<LLMProvider, string> = {
  'opencode-free': 'OPENCODE_API_KEY', // pool fallback; see opencodeKeyPool()
  opencode: 'OPENCODE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  'deepseek-direct': 'DEEPSEEK_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  qwen: 'QWEN_API_KEY',
  litellm: 'LITELLM_API_KEY',
  dsh: 'OPENCODE_API_KEY',
  ollama: 'OLLAMA_ENABLED',
};

/** Bootstrap default until the Keywire-maintained catalog publishes the list. */
const DEFAULT_FREE_MODEL = 'muse-spark-1.2-contributor-free';
const OPENROUTER_DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning:free';

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  // Zen free tier — current catalog winner by default; callProvider() resolves
  // the live model set from model-routing.json when present.
  'opencode-free': DEFAULT_FREE_MODEL,
  opencode: 'deepseek-v4-flash',
  // OpenRouter free variant — override via OPENROUTER_FREE_MODEL.
  openrouter: process.env.OPENROUTER_FREE_MODEL ?? OPENROUTER_DEFAULT_MODEL,
  // Direct api.deepseek.com provider — `deepseek-v4-flash` is an opencode-only
  // model name; the real DeepSeek API serves `deepseek-chat` / `deepseek-reasoner`.
  // Using the wrong name made the deepseek fallback return empty and skip.
  deepseek: 'deepseek-chat',
  'deepseek-direct': 'deepseek-chat',
  gemini: 'gemini-3.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
  qwen: 'qwen-plus',
  litellm: 'gpt-4o-mini',
  dsh: 'fleet-free',
  // Local Ollama tier — qwen3:0.6b is the installed fast model (tool-calling
  // capable, ~34 tok/s on this CPU vs ~7 for the 4.6B workhorse).
  ollama: process.env.OLLAMA_MODEL ?? 'qwen3:0.6b',
};

/** Resolution order when no explicit provider is requested. Free + local tiers first, paid last. */
const FALLBACK_ORDER: LLMProvider[] = [
  // OpenCode Zen free (zen/v1) — ecosystem primary, cycling accounts × free models.
  'opencode-free',
  // OpenRouter free (:free) models — second free tier (OPENROUTER_API_KEY).
  'openrouter',
  // Local Ollama (free, on-device) — used for cheap/quick calls before paying.
  'ollama',
  // Funded Go tier (zen/go/v1, deepseek-v4-flash) — paid, keeps fleet moving.
  'opencode',
  // DeepSeek direct (api.deepseek.com, deepseek-chat) — PAID (no longer free); last resort.
  'deepseek',
];

export function hasKey(provider: LLMProvider): boolean {
  // Ollama is a local model server — no API key needed, but it should only be
  // treated as an active provider when explicitly enabled. This prevents a
  // machine without any cloud tokens from being forced through the local tier
  // when the daemon is absent, and lets the deterministic fallback take over.
  if (provider === 'ollama') {
    const enabled = process.env.OLLAMA_ENABLED;
    return enabled === undefined ? true : enabled !== '0' && enabled !== 'false' && enabled !== 'no';
  }
  if (provider === 'opencode-free') return opencodeKeyPool().length > 0;
  return !!process.env[PROVIDER_ENV[provider]];
}

// ============================================================================
// Free-tier catalog (Keywire-owned): model list + per-account opencode key pool.
// Data-driven — the runtime NEVER hard-marries a single free model id. The daily
// pool-health/free-catalog sync probes the live Zen + OpenRouter catalogs and
// writes .draymond/model-routing.json; Keywire vault sync writes the account
// keys to data/litellm.env. muse-spark-1.2-contributor-free is only the default
// until the catalog publishes otherwise.
// ============================================================================

const OPENCODE_KEY_NAMES = [
  'OPENCODE_KEY_TAP919BEATS',
  'OPENCODE_KEY_NCSOUND919',
  'OPENCODE_KEY_TAP4500',
  'OPENCODE_API_KEY', // default account
  'OPENCODE_KEY_JOHNREDD', // operator's personal account — last resort only
];

let _keyPoolLoaded = false;

/** Load the Keywire-synced vault env (data/litellm.env) into process.env. */
function loadKeyPoolIntoEnv(): void {
  if (_keyPoolLoaded) return;
  _keyPoolLoaded = true;
  // Never read real vault keys during test runs (vitest sets VITEST=true,
  // NODE_ENV=test). Tests drive llm.ts purely via process.env.
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return;
  const root = process.env.DRAYMOND_REGISTRY_DIR
    ? resolve(process.env.DRAYMOND_REGISTRY_DIR, '..')
    : process.cwd();
  // PRECEDENCE: .env.local first (operator-managed, matches fleet-manifest
  // injection); the Keywire-vault-projected litellm.env only contributes keys
  // absent there. Vault copies can lag operator key rotations.
  for (const rel of ['.env.local', 'data/litellm.env']) {
    let raw: string;
    try {
      raw = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue; // file absent — try the next candidate
    }
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
      if (k && v && process.env[k] === undefined) process.env[k] = v;
    }
  }
}

/** Env var names in the opencode account pool (catalog wins; static default otherwise). */
function opencodeKeyNames(): string[] {
  loadKeyPoolIntoEnv();
  const c = readFreeCatalog();
  const names = c.opencodeKeyPool;
  return Array.isArray(names) && names.length > 0 ? names : OPENCODE_KEY_NAMES;
}

/** Actual opencode API key values available for free-tier calls. */
function opencodeKeyPool(): string[] {
  const values = opencodeKeyNames()
    .map((n) => process.env[n])
    .filter((v): v is string => !!v && v.trim() !== '');
  return values;
}

let _catalog: Record<string, any> | null | undefined;
let _catalogMtime = 0;

/** Read .draymond/model-routing.json (fail-soft: {} when absent). */
function readFreeCatalog(): Record<string, any> {
  try {
    const p = join(registryDir(), 'model-routing.json');
    const raw = readFileSync(p, 'utf8');
    const mtime = statSync(p).mtimeMs;
    if (_catalog === undefined || mtime !== _catalogMtime) {
      // Strip a UTF-8 BOM — PowerShell writers emit one and JSON.parse chokes,
      // which silently reverts the whole hot path to stale DEFAULT_FREE_MODEL.
      const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      _catalog = JSON.parse(clean) as Record<string, any>;
      _catalogMtime = mtime;
    }
  } catch {
    _catalog = {};
  }
  return _catalog ?? {};
}

function registryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? join(process.cwd(), '.draymond');
}

/**
 * Ordered free-model list for Zen. Assigned model first (catalog/env), then any
 * remaining catalog free models. Env overrides let a standalone process pin the
 * list without the catalog. Always falls back to the bootstrap default.
 */
function freeModelList(): string[] {
  const c = readFreeCatalog();
  const assigned = process.env.ASSIGNED_FREE_MODEL || c.assignedFreeModel || DEFAULT_FREE_MODEL;
  const envList = (process.env.FREE_MODEL_LIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const catalogList = Array.isArray(c.freeModelList) ? (c.freeModelList as string[]) : [];
  const list = envList.length > 0 ? envList : catalogList;
  return [...new Set([assigned, ...list])];
}

let _freeCursor = 0;
let _keyCursor = 0;

/** Round-robin cursor for account rotation across calls. */
function nextKeyIndex(len: number): number {
  if (len <= 0) return 0;
  const i = _keyCursor % len;
  _keyCursor = (i + 1) % len;
  return i;
}

/** Round-robin cursor for free-model rotation across calls. */
function nextModelIndex(len: number): number {
  if (len <= 0) return 0;
  const i = _freeCursor % len;
  _freeCursor = (i + 1) % len;
  return i;
}

/**
 * Build the provider order for a call: the preferred provider first (if its
 * key is configured), then every configured provider in fallback order.
 * With localFirst, the local Ollama tier is promoted ahead of the paid chain.
 */
export function buildProviderOrder(preferred?: LLMProvider, localFirst = false): LLMProvider[] {
  const order: LLMProvider[] = [];
  const add = (p: LLMProvider) => {
    if (!order.includes(p) && hasKey(p)) order.push(p);
  };
  if (preferred) add(preferred);
  if (localFirst) add('ollama');
  for (const p of FALLBACK_ORDER) add(p);
  if (localFirst && !order.includes('ollama') && hasKey('ollama')) order.unshift('ollama');
  return order;
}

/** Resolve the single best provider when callers need one up front. */
export function resolveLLMProvider(preferred?: LLMProvider): LLMProvider {
  const order = buildProviderOrder(preferred);
  if (order.length === 0) {
    throw new Error(
      'No LLM API key configured. Set OPENCODE_API_KEY, DEEPSEEK_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or QWEN_API_KEY.'
    );
  }
  return order[0];
}

function getApiKey(provider: LLMProvider): string {
  // Ollama is a local server — no API key required (OLLAMA_ENABLED gates it).
  if (provider === 'ollama') return '';
  const key = process.env[PROVIDER_ENV[provider]];
  if (!key) throw new Error(`Missing API key for provider "${provider}"`);
  return key;
}

async function callGemini(options: LLMCallOptions): Promise<string> {
  const apiKey = getApiKey('gemini');
  const model = options.model ?? DEFAULT_MODELS.gemini;
  const maxTokens = options.maxTokens ?? 1024;
  const temperature = options.temperature ?? 0.2;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const contents = [
    {
      role: 'user',
      parts: [
        { text: options.userMessage },
        ...(options.images?.length ? buildImageParts(options.images, 'gemini') : []),
      ],
    },
  ];
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  };
  if (options.system) body.systemInstruction = { parts: [{ text: options.system }] };
  if (options.responseFormat) {
    (body.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${PROVIDER_URLS.gemini}/${model}:generateContent`;

    // `AQ.` keys are Google's new auth-key format. Official docs send them via
    // x-goog-api-key, but some accounts need the OAuth Bearer header — try both.
    const attempts: Array<Record<string, string>> = [
      { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    ];

    let lastErr: unknown;
    for (const headers of attempts) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
        }
        const data = (await res.json()) as Record<string, unknown>;
        const text = (data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>)?.[0]
          ?.content?.parts?.[0]?.text ?? '';
        if (!text) throw new Error('Empty response from Gemini');
        return text;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error('Gemini auth failed');
  } finally {
    clearTimeout(timer);
  }
}

/** Serialize image inputs for a provider's message format. */
function buildImageParts(images: NonNullable<LLMCallOptions['images']>, provider: LLMProvider): unknown[] {
  if (provider === 'anthropic') {
    return images.map((i) => ({
      type: 'image',
      source: { type: 'base64', media_type: i.mediaType, data: i.dataB64 },
    }));
  }
  if (provider === 'gemini') {
    return images.map((i) => ({
      inlineData: { mimeType: i.mediaType, data: i.dataB64 },
    }));
  }
  // OpenAI-compatible providers (opencode, deepseek, openai, qwen, litellm).
  return images.map((i) => ({
    type: 'image_url',
    image_url: { url: `data:${i.mediaType};base64,${i.dataB64}` },
  }));
}

/** Single-provider request. Throws on any non-success so the chain can retry. */
async function callProvider(provider: LLMProvider, options: LLMCallOptions): Promise<string> {
  if (provider === 'gemini') return callGemini(options);
  // OpenCode Zen free tier is data-driven: it cycles the Keywire account pool
  // and the catalog free-model list instead of using a single key/model.
  if (provider === 'opencode-free') return callOpenCodeFree(options);

  const apiKey = getApiKey(provider);
  const apiUrl = PROVIDER_URLS[provider];
  const model =
    options.model ??
    (provider === 'ollama' && options.images?.length
      ? process.env.OLLAMA_VISION_MODEL ?? 'qwen3.5:4b'
      : options.reasoning && provider === 'deepseek'
        ? 'deepseek-reasoner'
        : DEFAULT_MODELS[provider]);
  const maxTokens = options.maxTokens ?? 1024;
  const temperature = options.temperature ?? 0.2;
  // Reasoning calls get a much longer default timeout; the local Ollama tier
  // still needs its own generous window for cold-start model loads.
  const timeoutMs = options.timeoutMs ?? (options.reasoning ? 120_000 : provider === 'ollama' ? 90_000 : 15_000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;

    if (provider === 'anthropic') {
      const content: string | unknown[] = options.images?.length
        ? [{ type: 'text', text: options.userMessage }, ...buildImageParts(options.images, provider)]
        : options.userMessage;
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          // Anthropic rejects `temperature` alongside extended thinking.
          ...(options.reasoning
            ? { thinking: { type: 'enabled', budget_tokens: 4096 } }
            : { temperature }),
          system: options.system,
          messages: [{ role: 'user', content }],
        }),
        signal: controller.signal,
      });
    } else if (provider === 'ollama' && options.images?.length) {
      // Ollama's native /api/chat (not OpenAI-compat) reliably accepts base64
      // images for GGUF vision models. Build the native payload directly.
      const base = apiUrl.replace(/\/v1\/chat\/completions$/, '');
      const nativeUrl = `${base}/api/chat`;
      response = await fetch(nativeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.userMessage, images: options.images.map((i) => i.dataB64) },
          ],
          stream: false,
          ...(options.responseFormat ? { format: 'json' } : {}),
          options: { temperature: temperature ?? 0.2, num_predict: maxTokens },
        }),
        signal: controller.signal,
      });
      const nativeData = (await response.json()) as { message?: { content?: string } };
      if (!response.ok) {
        const errText = JSON.stringify(nativeData).slice(0, 200);
        throw new Error(`Ollama API error ${response.status}: ${errText}`);
      }
      const content = nativeData.message?.content ?? '';
      if (!content) throw new Error('Empty response from Ollama');
      return content;
    } else {
      const content: unknown = options.images?.length
        ? [
            { type: 'text', text: options.userMessage },
            ...buildImageParts(options.images, provider),
          ]
        : options.userMessage;
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...(options.reasoning ? {} : { temperature }),
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content },
          ],
          // Ollama uses `format: "json"` (not OpenAI `response_format`).
          ...(options.responseFormat && provider === 'ollama'
            ? { format: 'json' }
            : options.responseFormat
              ? { response_format: options.responseFormat }
              : {}),
          ...(options.reasoning ? { reasoning_effort: 'high' } : {}),
        }),
        signal: controller.signal,
      });
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`LLM API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (provider === 'anthropic') {
      const content = (data.content as Array<{ text?: string }>)?.[0]?.text ?? '';
      if (!content) throw new Error('Empty response from LLM');
      return content;
    }

    const choices = data.choices as Array<{ message?: { content?: string } }>;
    let content = choices?.[0]?.message?.content ?? '';
    // Some opencode/deepseek responses put the answer in `reasoning_content`
    // with empty `content` when max_tokens is small. Retry once with a larger
    // budget before giving up so the fallback chain isn't tripped.
    if (!content && provider.startsWith('opencode')) {
      const bigger = Math.max(maxTokens, 512);
      const retry = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: bigger,
          temperature,
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.userMessage },
          ],
          ...(options.responseFormat && provider === 'ollama'
            ? { format: 'json' }
            : options.responseFormat
              ? { response_format: options.responseFormat }
              : {}),
        }),
        signal: controller.signal,
      });
      if (retry.ok) {
        const retryData = (await retry.json()) as Record<string, unknown>;
        const retryChoices = retryData.choices as Array<{ message?: { content?: string } }>;
        content = retryChoices?.[0]?.message?.content ?? '';
      }
    }
    if (!content) throw new Error('Empty response from LLM');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

// ── OpenCode Zen free tier: account × free-model cycling ─────────────────────
// Data-driven: the Keywire-maintained catalog (.draymond/model-routing.json)
// owns the free-model list and the account key pool. The runtime rotates the
// STARTING account/model round-robin per call and retries across accounts then
// models on retryable statuses (429/401/404/5xx/network), so quota spreads over
// every opencode account and survives a model being rotated out upstream.

function isRetryableFreeStatus(status: number | null): boolean {
  if (status === null) return true; // network/timeout — try the next account
  return status === 429 || status === 401 || status === 404 || status >= 500;
}

async function callOpenCodeFree(options: LLMCallOptions): Promise<string> {
  const keys = opencodeKeyPool();
  if (!keys.length) throw new Error('No opencode free key configured');
  const models = freeModelList();
  if (!models.length) throw new Error('No free model configured');

  const apiUrl = PROVIDER_URLS['opencode-free'];
  const maxTokens = options.maxTokens ?? 1024;
  const temperature = options.temperature ?? 0.2;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const startKey = nextKeyIndex(keys.length);
  const startModel = nextModelIndex(models.length);
  let lastErr: unknown;

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[(startModel + mi) % models.length];
    for (let ki = 0; ki < keys.length; ki++) {
      const key = keys[(startKey + ki) % keys.length];
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const payload = (maxTokensValue: number) =>
            JSON.stringify({
              model,
              max_tokens: maxTokensValue,
              temperature,
              messages: [
                { role: 'system', content: options.system },
                { role: 'user', content: options.userMessage },
              ],
              ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
            });
          const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };

          const res = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: payload(maxTokens),
            signal: controller.signal,
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`LLM API error ${res.status}: ${errText.slice(0, 200)}`);
          }
          const data = (await res.json()) as Record<string, unknown>;
          const choices = data.choices as Array<{ message?: { content?: string } }>;
          let content = choices?.[0]?.message?.content ?? '';
          // Some free models return empty `content` with `reasoning_content`
          // when max_tokens is small — retry once with a bigger budget.
          if (!content) {
            const retryRes = await fetch(apiUrl, {
              method: 'POST',
              headers,
              body: payload(Math.max(maxTokens, 512)),
              signal: controller.signal,
            });
            if (!retryRes.ok) {
              const errText = await retryRes.text().catch(() => '');
              throw new Error(`LLM API error ${retryRes.status}: ${errText.slice(0, 200)}`);
            }
            const retryData = (await retryRes.json()) as Record<string, unknown>;
            content =
              (retryData.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content ?? '';
          }
          if (!content) throw new Error('Empty response from LLM');
          return content;
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        lastErr = err;
        const status = err instanceof Error
          ? (Number(/LLM API error (\d+)/.exec(err.message)?.[1] ?? 0) || null)
          : null;
        // Hard client errors (400/403/422) mean the payload is bad — don't rotate.
        if (status !== null && !isRetryableFreeStatus(status)) throw err;
      }
    }
  }
  throw lastErr ?? new Error('All opencode free accounts/models failed');
}

/**
 * Call the LLM across the provider chain and return the text content.
 * Tries the preferred provider first, then every configured provider in
 * fallback order. Throws only when all providers fail.
 */
export async function callLLM(options: LLMCallOptions): Promise<string> {
  // Skill-aware routing: if a skillId is provided and skill-model-map.json exists,
  // the skill's tier overrides the default provider order.
  const skillOverride = options.skillId ? await consultSkillMap(options.skillId) : undefined;
  if (skillOverride) {
    return callLLM({ ...options, provider: skillOverride.provider as LLMProvider, model: skillOverride.model, skillId: undefined });
  }

  // Normalize the token budget: explicit maxTokens wins, else the mode's budget
  // (mathx MODE_MAX_TOKENS), else the 1024 default. Opt-in truncation keeps
  // oversized context within budget before any provider is hit.
  const budget = options.maxTokens ?? (options.mode ? maxTokensForMode(options.mode) : 1024);

  // TOON-compress structured JSON blocks in the messages when opted in. Applied
  // BEFORE truncation so the saved tokens extend the effective context budget.
  const { prepareLLMMessages } = await import('./toonify');
  const prepared = prepareLLMMessages(options);

  const effective: LLMCallOptions = {
    ...options,
    system: prepared.system,
    userMessage: prepared.userMessage,
    maxTokens: budget,
  };
  if (options.truncate && prepared.userMessage) {
    effective.userMessage = truncateToTokens(prepared.userMessage, budget, 'prose');
  }

  // Vision provider order: fleet policy is local-first (VISION_ROUTING != '0') so
  // qwen3.5:4b handles screenshots/images without spending cloud tokens.
  // Set VISION_ROUTING=0 to revert to cloud-first (legacy behaviour).
  const CLOUD_VISION: LLMProvider[] = ['anthropic', 'gemini', 'openai'];
  const visionLocalFirst = process.env.VISION_ROUTING !== '0';
  const localFirst = options.localFirst === true;
  const order: LLMProvider[] = options.images?.length
    ? (visionLocalFirst
        ? (['ollama' as LLMProvider]).concat(CLOUD_VISION.filter(hasKey)).concat(buildProviderOrder(options.provider, false))
        : CLOUD_VISION.filter(hasKey).concat(buildProviderOrder(options.provider, false)))
    : buildProviderOrder(options.provider, localFirst);
  const deduped = [...new Set(order)];

  if (order.length === 0) {
    const fb = await resolveFallbackValue(options, 'No LLM API key configured');
    if (fb !== null) return fb;
    throw new Error(
      'No LLM API key configured. Set OPENCODE_API_KEY, DEEPSEEK_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or QWEN_API_KEY.'
    );
  }

  let lastErr: unknown;
  // Pre-gate: if the projected fleet budget can't cover this call, skip the
  // whole provider chain rather than burning attempts. The per-provider gate
  // inside the loop still applies; this is the early-out for the shared cap.
  {
    const { canCallFleet } = await import('./workflow-budget');
    const fleetGate = canCallFleet(budget);
    if (!fleetGate.ok) {
      const fb = await resolveFallbackValue(options, fleetGate.reason);
      if (fb !== null) return fb;
      throw new Error(fleetGate.reason);
    }
  }

  // Degraded-mode short-circuit: the circuit breaker has flipped, so skip the
  // slow provider chain entirely and go straight to the deterministic output.
  // Only when a fallbackKey is declared — bare `deterministicFallback` is too
  // cheap to short-circuit for (it costs one check).
  if (options.fallbackKey && isDegraded()) {
    const fb = await resolveFallbackValue(options, 'degraded mode active');
    if (fb !== null) return fb;
  }

  for (const provider of deduped) {
    try {
      // Budget gate: skip a provider whose daily token budget is exhausted or
      // whose rolling rate window is full — don't over-hit the API feeds.
      const { canCallProvider, consumeTokens } = await import('./workflow-budget');
      const gate = canCallProvider(provider);
      if (!gate.ok) {
        lastErr = new Error(gate.reason);
        console.warn(`[llm] ${gate.reason}. Trying next.`);
        continue;
      }
      // When falling back to a different provider, drop the preferred provider's
      // explicit model so each provider uses its own default (e.g. ollama must
      // not inherit `deepseek-v4-flash`).
      const perProvider: LLMCallOptions =
        provider === options.provider
          ? effective
          : { ...effective, model: undefined };
      const text = await callProvider(provider, perProvider);
      consumeTokens(provider, budget + 512); // approximate cost
      recordChainSuccess();
      return text;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[llm] provider "${provider}" failed: ${err instanceof Error ? err.message : String(err)}. Trying next.`
      );
    }
  }
  // Deterministic fallback: a total LLM outage returns a fixed templated value
  // (from the registry, or the inline string) so the pipeline keeps moving
  // instead of getting stuck.
  //
  // Count the chain failure BEFORE resolving the fallback. With full registry
  // coverage (34/34) the old order — resolve first, count only when null —
  // meant the circuit breaker could never trip organically and degraded-mode
  // escalation never activated: broken primaries were masked forever. The
  // breaker auto-clears after its window and provider successes still call
  // recordChainSuccess(), so this only fires on genuine total-chain failures.
  recordChainFailure();
  const fb = await resolveFallbackValue(options, lastErr);
  if (fb !== null) {
    console.warn(
      `[llm] DEGRADED-SUCCESS: deterministic fallback served the call — primary LLM chain is down (last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}).`,
    );
    return fb;
  }
  throw lastErr ?? new Error('All LLM providers failed');
}

/**
 * Resolve the deterministic fallback for a call. Order: inline
 * `deterministicFallback` (explicit wins), then the registry `fallbackKey`
 * (which may escalate to the deterministic brain when degraded).
 * Returns null when neither is configured.
 */
async function resolveFallbackValue(options: LLMCallOptions, reason: unknown): Promise<string | null> {
  if (options.deterministicFallback !== undefined) {
    console.warn(
      `[llm] all providers failed — returning deterministic fallback. Reason: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
    return options.deterministicFallback;
  }
  if (options.fallbackKey) {
    const ctx: FallbackContext = {
      userMessage: options.userMessage,
      system: options.system,
      ...options.fallbackContext,
    };
    const fb = await resolveFallbackAsync(options.fallbackKey, ctx);
    if (fb !== null) {
      console.warn(
        `[llm] all providers failed — returning registry fallback "${options.fallbackKey}". Reason: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      return fb;
    }
  }
  return null;
}

/**
 * Clean small-model output for downstream parsers: strip fenced code blocks
 * (```json ... ```) and leading/trailing prose so JSON.parse works. Small
 * models frequently wrap JSON in fences; callers expect a bare object.
 */
function cleanLocalOutput(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(trimmed);
  if (fence) return fence[1].trim();
  return trimmed;
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Small, cheap local-model call for tool-calling / quick classification.
 * Runs qwen3:0.6b via Ollama — near-zero cost, no API keys. Falls back to
 * the normal provider chain when Ollama is unreachable.
 */
export async function callLocalModel(options: {
  system: string;
  userMessage: string;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' };
  /** Disable RAG context injection (for hot loops that don't need it). */
  noRag?: boolean;
  /**
   * Compress the RAG context block with LLMLingua-2 (best-effort, ~1s).
   * Defaults to ON when the compressor service is reachable; set false to skip.
   */
  compressRag?: boolean;
  /** Deterministic fallback when even the paid chain is unavailable. */
  deterministicFallback?: string;
  /** Registry key for a deterministic fallback (see ./fallbacks). */
  fallbackKey?: string;
  /** Extra context passed to the registered fallback resolver. */
  fallbackContext?: FallbackContext;
}): Promise<string> {
  // Lightweight RAG: pull recent lessons + important memory to augment the
  // small model's context (it can't recall system history itself).
  let system = options.system;
  if (!options.noRag) {
    try {
      const { retrieveContext, augmentWithContext } = await import('./retrieval');
      const { block } = await retrieveContext(
        options.userMessage,
        options.compressRag !== false,
      );
      system = augmentWithContext(options.system, block);
    } catch {
      // RAG is best-effort; ignore failures.
    }
  }
  const wantJson = options.responseFormat?.type === 'json_object';
  const localOpts = {
    ...options,
    system,
    provider: 'ollama' as const,
    maxTokens: options.maxTokens ?? 256,
    temperature: 0.1,
    // The ollama attempt must still throw on failure so the paid chain runs;
    // the deterministic fallback only applies after the whole chain is down.
    deterministicFallback: undefined,
  };
  try {
    const raw = await callLLM(localOpts);
    const cleaned = cleanLocalOutput(raw);
    if (wantJson && !isValidJson(cleaned)) {
      // Small models are variable on structured output — one retry with a
      // sharper "ONLY valid JSON" instruction before falling back to paid.
      const retryRaw = await callLLM({
        ...localOpts,
        system: `${system}\nReturn ONLY a single valid JSON object. No code fences, no markdown, no explanation.`,
        temperature: 0.0,
      });
      const cleanedRetry = cleanLocalOutput(retryRaw);
      if (isValidJson(cleanedRetry)) return cleanedRetry;
    }
    return cleaned;
  } catch (err) {
    console.warn(
      `[llm] local model unavailable (${err instanceof Error ? err.message : String(err)}). Falling back.`
    );
    // Fall back to the paid chain, explicitly skipping ollama (which just failed).
    return callLLM({
      ...options,
      system,
      provider: 'litellm',
      maxTokens: options.maxTokens ?? 512,
      deterministicFallback: options.deterministicFallback,
    });
  }
}

/**
 * Consult .draymond/skill-model-map.json for a skill's assigned model tier.
 * Returns null when the map is absent or the skill is unmapped — callers fall
 * through to the normal provider chain (fail-soft, never throws).
 */
let _skillMap: Record<string, { provider: string; model: string }> | null | undefined;
let _skillMapMtime = 0;
async function consultSkillMap(skillId: string): Promise<{ provider: string; model: string } | null> {
  try {
    const { readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const registryDir = process.env.DRAYMOND_REGISTRY_DIR ?? join(process.cwd(), '.draymond');
    const mapPath = join(registryDir, 'skill-model-map.json');
    const mtime = statSync(mapPath).mtimeMs;
    if (_skillMap === undefined || mtime !== _skillMapMtime) {
      const raw = JSON.parse(readFileSync(mapPath, 'utf8')) as {
        skills?: Record<string, { provider: string; model: string }>;
      };
      _skillMap = raw.skills ?? {};
      _skillMapMtime = mtime;
    }
    return _skillMap?.[skillId] ?? null;
  } catch {
    return null; // map absent or unreadable — fail soft
  }
}

/**
 * Route a vision subtask to the local Ollama lane (qwen3.5:4b by default).
 * Always uses the local lane first; falls back to cloud vision providers when
 * Ollama is unreachable. Results come back as plain text — callers continue
 * on their own primary model after receiving the result (swap-back pattern).
 */
export async function callVisionSubtask(options: LLMCallOptions & { images: NonNullable<LLMCallOptions['images']> }): Promise<string> {
  const visionModel = process.env.OLLAMA_VISION_MODEL ?? 'qwen3.5:4b';
  try {
    const result = await callLLM({
      ...options,
      provider: 'ollama',
      model: visionModel,
      localFirst: true,
      timeoutMs: options.timeoutMs ?? 120_000,
      skillId: undefined,
    });
    console.info(`[llm] vision subtask completed on ${visionModel}; caller resumes on primary model`);
    return result;
  } catch (err) {
    console.warn(`[llm] local vision lane failed (${err instanceof Error ? err.message : String(err)}); falling back to cloud vision providers`);
    return callLLM({
      ...options,
      provider: undefined,
      localFirst: false,
      skillId: undefined,
    });
  }
}

