// ============================================================================
// DRAYMOND → DETERMINISTIC BRAIN CLIENT
// ============================================================================
// Thin HTTP bridge to the Python deterministic-brain (agents/deterministic-
// brain), the metacognitive observer that runs Recognition → Labeling →
// Intervention over the Graphify knowledge graph and emits structured
// proposals. Draymond calls it for "what did the brain find" (status) and
// "run the brain" (sweep).
//
// Gated on BRAIN_URL: when unset this module is a strict no-op (returns null),
// so unit tests and un-configured installs never make a network call.
// ============================================================================

const brainEnv = (): string => process.env.BRAIN_URL ?? '';

export interface BrainFinding {
  node_id: string;
  finding_type: string;
  severity: string;
  evidence_path: string;
  proposed_change: string;
  confidence: number;
  dependencies_affected: string[];
  source: string;
  run_id: string;
  timestamp: string;
  community: string | null;
  component_class: string;
  status: string;
}

export interface BrainRunReport {
  run_id: string;
  mode: string;
  started_at: string;
  ended_at: string;
  latency_ms: number;
  scope: Record<string, unknown>;
  findings: BrainFinding[];
  summary: Record<string, unknown>;
  self_reflection: Record<string, unknown>;
}

export interface BrainStatus {
  last_run_at: string | null;
  last_run: Record<string, unknown> | null;
  total_findings: number;
  open_findings: number;
  communities: string[];
  ledger_path: string;
}

/** True when BRAIN_URL is configured. */
export function isBrainConfigured(): boolean {
  return Boolean(brainEnv());
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${brainEnv().replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Deterministic brain ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Latest brain sweep status, or null when unconfigured / unreachable. */
export async function getBrainStatus(): Promise<BrainStatus | null> {
  if (!isBrainConfigured()) return null;
  try {
    return await req<BrainStatus>('/brain/status');
  } catch {
    return null;
  }
}

/** Trigger one bounded brain sweep, or null when unconfigured / unreachable. */
export async function runBrainSweep(
  opts: { mode?: string; scope?: string; community?: string; maxFindings?: number } = {},
): Promise<BrainRunReport | null> {
  if (!isBrainConfigured()) return null;
  try {
    return await req<BrainRunReport>('/brain/sweep', {
      method: 'POST',
      body: JSON.stringify({
        mode: opts.mode ?? 'manual',
        scope: opts.scope ?? 'all',
        community: opts.community ?? null,
        max_findings: opts.maxFindings ?? 20,
      }),
    });
  } catch {
    return null;
  }
}
