// ============================================================================
// DRAYMOND — Deterministic Fallback Registry
// ============================================================================
// One registry for "what do I output when EVERY LLM provider is down?"
//
// Every LLM function in the fleet can declare a deterministic fallback by key
// instead of hand-writing ad-hoc templates. callLLM/callLocalModel accept a
// `fallbackKey`; when the whole provider chain fails, they resolve the key to
// a non-LLM, always-works output and return it (logging a `degraded` event).
//
// Registry entries are pure — they never touch the network. They may be:
//   - a static template          (kind: 'template')
//   - a computed rule-based value (kind: 'computed')
//   - a cached/state value       (kind: 'state')
//
// The registry also tracks fleet-level degraded mode (circuit breaker) and a
// live coverage metric so the % of LLM functions with a deterministic fallback
// is always auditable (see getFallbackCoverage()).
// ============================================================================

export type FallbackKind = 'template' | 'computed' | 'state' | 'brain';

export interface FallbackContext {
  /** The caller's user message (available without any LLM call). */
  userMessage?: string;
  /** The caller's system prompt (available without any LLM call). */
  system?: string;
  /** MathX mode, chain slug, etc. — whatever context the resolver needs. */
  [key: string]: unknown;
}

/** A resolver produces the deterministic output from local context only. */
export type FallbackResolver = (ctx: FallbackContext) => string;

/**
 * An async brain resolver asks the deterministic brain to finish the work.
 * Returns null when the brain is unreachable so the caller falls through to
 * the sync resolver (template/computed). Throwing is treated the same way.
 */
export type BrainResolver = (ctx: FallbackContext) => Promise<string | null>;

export interface FallbackEntry {
  /** Human-readable purpose (appears in coverage report). */
  label: string;
  kind: FallbackKind;
  /** Sync last-resort output (template/computed/state). */
  resolve: FallbackResolver;
  /** Optional brain escalation: run BEFORE resolve when the fleet is degraded. */
  brain?: BrainResolver;
}

/** Convenience: register a static template resolver. */
export function template(label: string, text: string): FallbackEntry {
  return { label, kind: 'template', resolve: () => text };
}

/** Convenience: register a computed resolver. */
export function computed(label: string, fn: FallbackResolver): FallbackEntry {
  return { label, kind: 'computed', resolve: fn };
}

/**
 * Convenience: register a "brain escalation" fallback — ask the deterministic
 * brain to finish the work (kind: 'brain'), with a static template as the last
 * resort when the brain is unreachable.
 *
 * `lastResort` may be a raw resolver function or a FallbackEntry (e.g. from
 * `computed()` / `template()`) — the entry's `resolve` is used in that case.
 */
export function brainFallback(
  label: string,
  brainFn: BrainResolver,
  lastResort: FallbackResolver | FallbackEntry,
): FallbackEntry {
  const resolve = typeof lastResort === 'function' ? lastResort : lastResort.resolve;
  return { label, kind: 'brain', resolve, brain: brainFn };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const REGISTRY = new Map<string, FallbackEntry>();

/** Register (or overwrite) a deterministic fallback for an LLM function key. */
export function registerFallback(key: string, entry: FallbackEntry): void {
  REGISTRY.set(key, entry);
}

/** True when a deterministic fallback is registered for the key. */
export function hasFallback(key: string): boolean {
  return REGISTRY.has(key);
}

/** Resolve the deterministic fallback for a key. Returns null when unregistered. */
export function resolveFallback(
  key: string,
  ctx: FallbackContext = {}
): string | null {
  const entry = REGISTRY.get(key);
  if (!entry) return null;
  try {
    return entry.resolve(ctx);
  } catch (err) {
    console.warn(`[fallbacks] resolver "${key}" threw: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Async resolve: when the entry has a `brain` escalation and the fleet is in
 * degraded mode, ask the deterministic brain to finish the work first; if the
 * brain is unreachable (or not wired), fall through to the sync resolver.
 */
export async function resolveFallbackAsync(
  key: string,
  ctx: FallbackContext = {},
  opts: { degraded?: boolean } = {}
): Promise<string | null> {
  const entry = REGISTRY.get(key);
  if (!entry) return null;

  if (entry.brain && (opts.degraded ?? isDegraded())) {
    try {
      const brainOut = await entry.brain(ctx);
      if (brainOut !== null && brainOut !== undefined && brainOut !== '') {
        return brainOut;
      }
    } catch (err) {
      console.warn(
        `[fallbacks] brain escalation "${key}" failed: ${err instanceof Error ? err.message : String(err)} — using template.`
      );
    }
  }

  try {
    return entry.resolve(ctx);
  } catch (err) {
    console.warn(`[fallbacks] resolver "${key}" threw: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fleet-level degraded mode (circuit breaker)
// ---------------------------------------------------------------------------

const DEGRADED_THRESHOLD = 3; // consecutive total-chain failures flips degraded mode
const RECOVERY_WINDOW_MS = 15 * 60 * 1000; // auto-clear after 15 min

let consecutiveFailures = 0;
let degradedUntil = 0;
let degraded = false;

/** Record a total-chain failure; flips degraded mode at the threshold. */
export function recordChainFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= DEGRADED_THRESHOLD) {
    degraded = true;
    degradedUntil = Date.now() + RECOVERY_WINDOW_MS;
    console.warn(
      `[fallbacks] ${consecutiveFailures} consecutive total LLM failures — degraded mode ON for ${RECOVERY_WINDOW_MS / 60000} min.`
    );
  }
}

/** Record a successful chain call; resets the breaker below threshold. */
export function recordChainSuccess(): void {
  if (consecutiveFailures === 0) return;
  consecutiveFailures = Math.max(0, consecutiveFailures - 2);
  if (consecutiveFailures === 0) {
    degraded = false;
    console.warn('[fallbacks] LLM recovered — degraded mode OFF.');
  }
}

/** True when the fleet is in degraded mode (auto-clears after the window). */
export function isDegraded(): boolean {
  if (!degraded) return false;
  if (Date.now() > degradedUntil) {
    degraded = false;
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

/**
 * Operator override — force degraded mode on/off from the command center.
 * When forced on, the auto-recovery window is pushed far out so the flag
 * stays until the operator clears it (or the breaker flips from real failures).
 * Calling `setDegraded(false)` clears both the forced flag and the breaker.
 */
export function setDegraded(force: boolean): boolean {
  if (force) {
    degraded = true;
    degradedUntil = Date.now() + Number(process.env.DRAYMOND_DEGRADED_FORCE_MS ?? 24 * 60 * 60 * 1000);
    console.warn('[fallbacks] degraded mode forced ON by operator.');
    return true;
  }
  degraded = false;
  consecutiveFailures = 0;
  degradedUntil = 0;
  console.warn('[fallbacks] degraded mode cleared by operator.');
  return false;
}

// ---------------------------------------------------------------------------
// Coverage metric
// ---------------------------------------------------------------------------

/** Every known LLM function key the fleet declares a fallback for. */
const KNOWN_LLM_FUNCTIONS = new Set<string>();

/** Declare that an LLM function exists (used for the coverage denominator). */
export function declareLlmFunction(key: string): void {
  KNOWN_LLM_FUNCTIONS.add(key);
}

/** Live coverage report: registered ÷ known LLM functions. */
export function getFallbackCoverage(): {
  total: number;
  covered: number;
  uncovered: string[];
  pct: number;
  degraded: boolean;
} {
  const total = KNOWN_LLM_FUNCTIONS.size;
  const covered = [...KNOWN_LLM_FUNCTIONS].filter((k) => REGISTRY.has(k)).length;
  const uncovered = [...KNOWN_LLM_FUNCTIONS].filter((k) => !REGISTRY.has(k));
  const pct = total === 0 ? 0 : Math.round((covered / total) * 1000) / 10;
  return { total, covered, uncovered, pct, degraded: isDegraded() };
}

/** Print the coverage report to console (script/CLI friendliness). */
export function printFallbackCoverage(): void {
  const c = getFallbackCoverage();
  console.log(`[fallbacks] coverage: ${c.covered}/${c.total} (${c.pct}%) degraded=${c.degraded}`);
  if (c.uncovered.length) {
    console.log(`[fallbacks] uncovered: ${c.uncovered.join(', ')}`);
  }
}
