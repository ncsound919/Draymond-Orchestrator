/**
 * Mode → provider routing and token budgets for the embedded Math X core.
 * Adapted from @mathx/math-core/src/modelRouter.ts to Draymond's provider set.
 *
 * Draymond's LLM providers (see src/lib/draymond/llm.ts):
 *   opencode-free (cheap default), opencode, deepseek, gemini, openai,
 *   anthropic, qwen, litellm.
 *
 * This module is dependency-free (guards any `process` access) so it runs in
 * both the Node cron runtime and the browser Math Lab.
 */

/** Draymond provider identifiers (structural match to llm.ts LLMProvider). */
export type MathProvider =
  | 'opencode-free'
  | 'opencode'
  | 'deepseek'
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'qwen'
  | 'litellm';

const MATH_MODES = new Set(['formula', 'deep-solve']);
const REASONING_MODES = new Set(['scientist', 'hypothesis', 'synergy']);

/**
 * Map a Math X mode to the cheapest suitable Draymond provider.
 * Symbolic/math modes prefer a math specialist (qwen), reasoning modes prefer
 * deepseek; everything else falls through to the low-cost opencode-free tier.
 * Falls back along a safe chain when a provider has no key configured.
 */
export function preferredProviderForMode(
  mode: string,
  hasKey: (p: MathProvider) => boolean = defaultHasKey,
): MathProvider {
  const prefer = (candidate: MathProvider, fallback: MathProvider): MathProvider =>
    hasKey(candidate) ? candidate : fallback;

  if (MATH_MODES.has(mode)) return prefer('qwen', prefer('deepseek', 'opencode-free'));
  if (REASONING_MODES.has(mode)) return prefer('deepseek', 'opencode-free');
  return 'opencode-free';
}

/** Availability check that reads environment keys (safe in browser: none set → false). */
function defaultHasKey(p: MathProvider): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  const keyEnv: Record<MathProvider, string> = {
    'opencode-free': 'OPENCODE_API_KEY',
    opencode: 'OPENCODE_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    gemini: 'GEMINI_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    qwen: 'QWEN_API_KEY',
    litellm: 'LITELLM_API_KEY',
  };
  return Boolean(process.env[keyEnv[p]]);
}

/** GET a URL as JSON with a hard per-request timeout. Returns null on any error. */
async function getJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * List models from a LOCAL OpenAI/Ollama-compatible server.
 *
 * Speaks both wire formats because the fleet's local tier is whichever server
 * the operator runs on :11434:
 *   - Ollama        → GET /api/tags   → { models: [{ name }] }
 *   - llama.cpp     → GET /v1/models  → { data:  [{ id }] }
 *   - LM Studio / vLLM → GET /v1/models
 * llama-server does NOT implement /api/tags, so probing only that endpoint
 * reports a healthy llama.cpp server as down (the local lane was invisible).
 * Returns [] when the server is unreachable or unhealthy.
 */
export async function fetchLocalModels(
  baseURL = 'http://localhost:11434',
  timeoutMs = 2000,
): Promise<string[]> {
  const base = baseURL.replace(/\/+$/, '');

  const tags = (await getJson(`${base}/api/tags`, timeoutMs)) as
    | { models?: Array<{ name?: string }> }
    | null;
  const names = (tags?.models ?? [])
    .map((m) => m.name)
    .filter((n): n is string => Boolean(n));
  if (names.length > 0) return names;

  const list = (await getJson(`${base}/v1/models`, timeoutMs)) as
    | { data?: Array<{ id?: string }> }
    | null;
  return (list?.data ?? []).map((m) => m.id).filter((n): n is string => Boolean(n));
}

/**
 * Probe a local (Ollama / llama.cpp / LM Studio / vLLM) endpoint for health.
 * Times out after `timeoutMs` (default 2 000 ms).
 */
export async function checkOllamaHealth(
  baseURL = 'http://localhost:11434',
  timeoutMs = 2000,
): Promise<boolean> {
  const models = await fetchLocalModels(baseURL, timeoutMs);
  return models.length > 0;
}

/**
 * Per-mode token budget. Deep Solve and Formula Lab need extra breathing room.
 * All other modes default to 4 000 tokens.
 */
export const MODE_MAX_TOKENS: Record<string, number> = {
  'deep-solve': 8000,
  formula: 6000,
  hypothesis: 6000,
  scientist: 4000,
  synergy: 4000,
  probability: 4000,
  'file-intel': 4000,
};

export function maxTokensForMode(mode: string, fallback = 4000): number {
  return MODE_MAX_TOKENS[mode] ?? fallback;
}
