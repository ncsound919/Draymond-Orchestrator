// ============================================================================
// DRAYMOND → DETERMINISTIC BRAIN TASK BRIDGE
// ============================================================================
// Escalation path for the fallback registry: when the LLM chain is totally
// down and the fleet flips into degraded mode, Draymond asks the deterministic
// brain to FINISH the work instead of just returning a static template.
//
// The brain runs a zero-LLM loop (Parse → Reason → Execute → Audit) over its
// skill packs + tool registry + Monte-Carlo scaffolder. It is NOT an LLM — it
// is the fleet's deterministic workhorse (agents/deterministic-brain, port
// 3210, BRAIN_URL). This bridge:
//   1. POSTs the degraded task to POST /task on the brain.
//   2. Returns the brain's final_output (string or JSON-serialized).
//   3. Returns null when the brain is unreachable / errors, so the fallback
//      registry falls through to its static template.
//
// Gated on BRAIN_URL: when unset this is a strict no-op (returns null), so
// un-configured installs and unit tests never make a network call.
// ============================================================================

const brainUrl = (): string => process.env.BRAIN_URL ?? '';

export interface BrainTaskResult {
  status?: string;
  final_output?: unknown;
  reasoning?: { chosen_skill?: string; confidence?: number };
  error?: string;
  knowledge_used?: number;
}

/** True when the deterministic brain is configured. */
export function isBrainTaskConfigured(): boolean {
  return Boolean(brainUrl());
}

/** Normalize a brain /research/publish response into usable text. */
function stringifyBrainResult(data: Record<string, unknown>): string | null {
  if (data.error) {
    console.warn(`[brain-task] brain returned error: ${String(data.error)}`);
    return null;
  }
  const body = data.body ?? data.final_output;
  if (body === undefined || body === null) {
    console.warn('[brain-task] brain returned no output');
    return null;
  }
  if (typeof body === 'string') {
    return body.trim() || null;
  }
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

const RESEARCH_PUBLISH_RE = /\b(research paper|research-paper|write a paper|create a paper|paper on|research report|publish research|paper about|white paper|write up)\b/i;

/**
 * Ask the deterministic brain to finish a task. Returns the brain's output as
 * text, or null when unconfigured / unreachable / errored.
 *
 * Research-paper requests are routed to the brain's deterministic
 * `/research/publish` endpoint (sources + renders a paper + publishes to
 * Global Lens — zero LLM). Everything else goes to `/task`.
 *
 * The brain's `final_output` may be a string (most lanes) or a structured
 * value (scheduler/social/list lanes) — structured values are JSON-serialized
 * so downstream consumers still get usable content.
 */
export async function runBrainTask(query: string, opts: { lane?: string; timeoutMs?: number } = {}): Promise<string | null> {
  if (!isBrainTaskConfigured()) return null;
  const base = brainUrl().replace(/\/+$/, '');

  // Research-paper intent → deterministic paper generation + Global Lens publish.
  if (RESEARCH_PUBLISH_RE.test(query) && !opts.lane) {
    try {
      const res = await fetch(`${base}/research/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: query, source_name: 'Overlay365 Deterministic Brain' }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        const out = stringifyBrainResult(data);
        if (out !== null) return out;
      } else {
        console.warn(`[brain-task] /research/publish failed: HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(
        `[brain-task] /research/publish unreachable: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    // Fall through to /task so the brain can still attempt the general loop.
  }

  try {
    const res = await fetch(`${base}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, lane_override: opts.lane ?? null }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    if (!res.ok) {
      console.warn(`[brain-task] /task failed: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as BrainTaskResult;
    const out = stringifyBrainResult(data as Record<string, unknown>);
    if (out !== null) return out;
    return null;
  } catch (err) {
    console.warn(
      `[brain-task] brain unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
