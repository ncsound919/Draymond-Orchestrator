// ============================================================================
// DRAYMOND — Shared LLM Call Helper (provider chain with fallback)
// ============================================================================
// Provider-agnostic LLM calls. Primary is DeepSeek V4 Flash (0731) served by
// OpenCode's free tier; if it fails (rate limit, outage, balance), the chain
// falls back to OpenCode Go (paid), then DeepSeek direct, then Gemini.
// All OpenAI-compatible providers share one request shape; Anthropic uses the
// Messages API; Gemini uses the Google Generative Language format.
// ============================================================================

import { truncateToTokens, maxTokensForMode } from '../mathx';

export type LLMProvider =
  | 'opencode-free'
  | 'opencode'
  | 'deepseek'
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'qwen'
  | 'litellm'
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
  /** Re-encode structured JSON blocks (```json fences, <context>) in the
   *  system/user messages as TOON when that measurably shrinks the payload.
   *  Lossless and length-gated — never corrupts a prompt. */
  toonify?: boolean;
}

const PROVIDER_URLS: Record<LLMProvider, string> = {
  'opencode-free': 'https://opencode.ai/zen/v1/chat/completions',
  opencode: 'https://opencode.ai/zen/go/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
  litellm: 'http://localhost:4100/v1/chat/completions',
  ollama: 'http://localhost:11434/v1/chat/completions',
};

const PROVIDER_ENV: Record<LLMProvider, string> = {
  'opencode-free': 'OPENCODE_API_KEY',
  opencode: 'OPENCODE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  qwen: 'QWEN_API_KEY',
  litellm: 'LITELLM_API_KEY',
  ollama: 'OLLAMA_ENABLED',
};

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  'opencode-free': 'deepseek-v4-flash-free',
  opencode: 'deepseek-v4-flash',
  deepseek: 'deepseek-v4-flash',
  gemini: 'gemini-3.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
  qwen: 'qwen-plus',
  litellm: 'gpt-4o-mini',
  ollama: 'llama3.2:1b',
};

/** Resolution order when no explicit provider is requested. */
const FALLBACK_ORDER: LLMProvider[] = [
  // Free tier first (no-cost); falls to Go when quota-limited or failing.
  'opencode-free',
  // Go tier — reliable paid models (deepseek-v4-flash etc.) via opencode.
  'opencode',
  // DeepSeek direct + Gemini direct.
  'deepseek',
  'gemini',
  // Local Ollama (free, on-device) — used for cheap/quick calls.
  'ollama',
  // Remaining providers.
  'openai',
  'anthropic',
  'qwen',
];

export function hasKey(provider: LLMProvider): boolean {
  // ollama is a local model server — no API key needed; enabled when reachable.
  if (provider === 'ollama') return true;
  return !!process.env[PROVIDER_ENV[provider]];
}

/**
 * Build the provider order for a call: the preferred provider first (if its
 * key is configured), then every configured provider in fallback order.
 */
export function buildProviderOrder(preferred?: LLMProvider): LLMProvider[] {
  const order: LLMProvider[] = [];
  const add = (p: LLMProvider) => {
    if (!order.includes(p) && hasKey(p)) order.push(p);
  };
  if (preferred) add(preferred);
  for (const p of FALLBACK_ORDER) add(p);
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

  const apiKey = getApiKey(provider);
  const apiUrl = PROVIDER_URLS[provider];
  const model = options.model ?? (options.reasoning && provider === 'deepseek' ? 'deepseek-reasoner' : DEFAULT_MODELS[provider]);
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

/**
 * Call the LLM across the provider chain and return the text content.
 * Tries the preferred provider first, then every configured provider in
 * fallback order. Throws only when all providers fail.
 */
export async function callLLM(options: LLMCallOptions): Promise<string> {
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

  // Vision inputs can only be served by image-capable providers — put them
  // first so OCR-style calls don't waste budget on text-only endpoints.
  const VISION_FIRST: LLMProvider[] = ['anthropic', 'gemini', 'openai'];
  const order = options.images?.length
    ? VISION_FIRST.filter(hasKey).concat(buildProviderOrder(options.provider))
    : buildProviderOrder(options.provider);
  const deduped = [...new Set(order)];
  if (order.length === 0) {
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
      if (options.deterministicFallback !== undefined) {
        console.warn(`[llm] ${fleetGate.reason} — returning deterministic fallback.`);
        return options.deterministicFallback;
      }
      throw new Error(fleetGate.reason);
    }
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
      return text;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[llm] provider "${provider}" failed: ${err instanceof Error ? err.message : String(err)}. Trying next.`
      );
    }
  }
  // Deterministic fallback (opt-in): a total LLM outage returns a fixed
  // templated value so the pipeline keeps moving instead of getting stuck.
  if (options.deterministicFallback !== undefined) {
    console.warn(
      `[llm] all providers failed — returning deterministic fallback. Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
    return options.deterministicFallback;
  }
  throw lastErr ?? new Error('All LLM providers failed');
}

/**
 * Small, cheap local-model call for tool-calling / quick classification.
 * Runs llama3.2:1b via Ollama — near-zero cost, no API keys. Falls back to
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
  try {
    return await callLLM({
      ...options,
      system,
      provider: 'ollama',
      maxTokens: options.maxTokens ?? 256,
      temperature: 0.1,
      // The ollama attempt must still throw on failure so the paid chain runs;
      // the deterministic fallback only applies after the whole chain is down.
      deterministicFallback: undefined,
    });
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
