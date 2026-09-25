// ============================================================================
// OPENHUB ECOSYSTEM REPAIR REPORT CLIENT — Draymond → OpenHub
// ============================================================================
// Draymond reports job/code failures to OpenHub's ecosystem-aware repair
// intake (POST /api/ecosystem/report). OpenHub resolves the tool's PRELOADED
// local folder, audits it, and dispatches the fix to Axiom with the same
// targetDir — Axiom/opencode never rescans the full codebase.
//
// Honesty contract:
//   - Fail-soft: if OpenHub is unreachable, this returns ok:false with an
//     honest reason — the caller's own repair path is never blocked by it.
//   - Only real failures are reported; nothing is fabricated.
//   - Never throws.
// ============================================================================

export interface OpenHubReportInput {
  /** Ecosystem registry tool id (e.g. 'draymond', 'recourse', 'global-lens'). */
  toolId: string;
  source: 'dev-brain' | 'draymond';
  severity: 'low' | 'medium' | 'high' | 'critical';
  kind: string;
  detail: string;
  preset?: 'quick' | 'standard' | 'deep' | 'release';
  goalOverride?: string;
  dedupKey?: string;
}

export interface OpenHubReportResult {
  ok: boolean;
  error?: string;
  dispatched?: string;
  loopId?: string;
  incidentId?: string;
  auditStatus?: string;
  grade?: string | null;
}

const openHubBase = (): string =>
  (process.env.OPENHUB_URL ?? process.env.OPENHUB_PUBLIC_URL ?? 'http://127.0.0.1:3010').replace(/\/+$/, '');

/** Auth token for OpenHub (Bearer). Uses OPENHUB_SERVICE_TOKEN when set. */
const authToken = (): string => process.env.OPENHUB_SERVICE_TOKEN ?? process.env.OPENHUB_TOKEN ?? '';

/** POST a failure report to OpenHub's ecosystem repair intake. Never throws. */
export async function reportToOpenHub(input: OpenHubReportInput): Promise<OpenHubReportResult> {
  const base = openHubBase();
  const token = authToken();
  if (!base) return { ok: false, error: 'OPENHUB_URL not configured' };

  try {
    const res = await fetch(`${base}/api/ecosystem/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...input, preset: input.preset ?? 'quick' }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const axiom = typeof data.axiom === 'object' && data.axiom !== null ? (data.axiom as Record<string, unknown>) : null;
    const incident = typeof data.incident === 'object' && data.incident !== null ? (data.incident as Record<string, unknown>) : null;
    const audit = typeof data.audit === 'object' && data.audit !== null ? (data.audit as Record<string, unknown>) : null;
    if (!res.ok) {
      return { ok: false, error: `OpenHub HTTP ${res.status}: ${String(data.error ?? res.statusText).slice(0, 300)}` };
    }
    return {
      ok: data.ok !== false,
      dispatched: typeof data.dispatch === 'string' ? (data.dispatch as string) : undefined,
      loopId: typeof data.loopId === 'string' ? (data.loopId as string) : typeof axiom?.loopId === 'string' ? String(axiom.loopId) : undefined,
      incidentId: typeof incident?.id === 'string' ? String(incident.id) : undefined,
      auditStatus: typeof audit?.overallStatus === 'string' ? String(audit.overallStatus) : undefined,
      grade: typeof audit?.grade === 'string' ? String(audit.grade) : null,
      ...(data.ok === false && typeof data.error === 'string' ? { error: data.error } : {}),
    };
  } catch (err) {
    return { ok: false, error: `OpenHub unreachable at ${base}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Best-effort report — swallows failures so the caller's own repair path is
 * never gated by OpenHub being down. Returns the result for logging.
 */
export async function reportToOpenHubBestEffort(input: OpenHubReportInput): Promise<OpenHubReportResult | null> {
  try {
    const result = await reportToOpenHub(input);
    if (!result.ok) {
      console.warn(`[openhub-report] not delivered to OpenHub: ${result.error}`);
    }
    return result;
  } catch {
    return null;
  }
}