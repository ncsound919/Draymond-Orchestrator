// ============================================================================
// DRAYMOND LOCAL REASONING — free, on-device reasoning for ops
// ============================================================================
// Draymond leans on the deterministic brain's LOCAL model (qwen3:0.6b fast
// tier via the brain's /local/harness/reason) for cheap, zero-token reasoning
// over ecosystem state: hiccup triage, repair dispatch rationale, and schedule
// notes. This is strictly best-effort and timeout-safe — every call fails soft
// so operations never stall on the brain or the local model being down.
//
// Falls back to the deterministic brain's /reason (still free) when the local
// harness is unreachable, and finally to null when the brain is down.
// ============================================================================

const BRAIN_URL = () => process.env.BRAIN_URL ?? '';
const REASON_TIMEOUT_MS = 30_000;

export interface LocalReasonResult {
  /** Where the reasoning came from: local-harness | brain-reason | null */
  source: 'local-harness' | 'brain-reason' | null;
  text: string;
}

/** Ask the local model (fast tier) via the brain's harness endpoint. */
async function callLocalHarness(query: string): Promise<string | null> {
  const url = BRAIN_URL().replace(/\/+$/, '');
  if (!url) return null;
  try {
    const res = await fetch(`${url}/local/harness/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem: query, thread: 'draymond-ops' }),
      signal: AbortSignal.timeout(REASON_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { answer?: string };
    const answer = (data.answer ?? '').trim();
    return answer || null;
  } catch {
    return null;
  }
}

/** Fall back to the deterministic brain's /reason (free, fast). */
async function callBrainReason(query: string): Promise<string | null> {
  const url = BRAIN_URL().replace(/\/+$/, '');
  if (!url) return null;
  try {
    const res = await fetch(`${url}/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(REASON_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { decision?: unknown };
    return data.decision ? JSON.stringify(data.decision).slice(0, 2000) : null;
  } catch {
    return null;
  }
}

/**
 * Local-first reasoning over ecosystem state. Never throws.
 * Order: local harness (fast model) → brain /reason (deterministic) → null.
 */
export async function reasonLocal(query: string): Promise<LocalReasonResult> {
  const local = await callLocalHarness(query);
  if (local) return { source: 'local-harness', text: local };
  const brain = await callBrainReason(query);
  if (brain) return { source: 'brain-reason', text: brain };
  return { source: null, text: '' };
}
