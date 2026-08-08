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

/**
 * Probe an Ollama-compatible endpoint and return whether it is healthy.
 * Times out after `timeoutMs` (default 2 000 ms).
 */
export async function checkOllamaHealth(
  baseURL = 'http://localhost:11434',
  timeoutMs = 2000,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${baseURL}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
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
