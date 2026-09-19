// ============================================================================
// MATHX → RECOURSE — deterministic engine bridge
// ============================================================================
// Recourse (agents/recourse, canonical port 3050) is the fleet's autonomous
// self-developing architecture OS. Its recursive-math loop, Lego composable-ML
// engine, sandboxed verifier, and template component builder are deterministic
// (no LLM) and are surfaced here as typed, fail-soft clients so the embedded
// math-x core and the /api/math/* route group can consume them.
//
// Honesty contract: every call reports `available:false` + `error` when the
// service is unreachable or returns non-2xx. Nothing is fabricated, no canned
// "offline fallback" pretends to be a real engine result.
// ============================================================================

const RECOURSE_URL = (process.env.RECOURSE_URL || 'http://localhost:3050').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.RECOURSE_TIMEOUT_MS || 8000);
// Guarded Recourse writes (fleet/memory, consolidate, ...) are fail-closed
// without this. Empty => the server returns 503 and we report available:false.
const RECOURSE_API_SECRET = process.env.RECOURSE_API_SECRET || '';

export interface RecourseResult<T> {
  available: boolean;
  data: T | null;
  error?: string;
  statusCode?: number;
}

async function get<T>(path: string): Promise<RecourseResult<T>> {
  try {
    const res = await fetch(`${RECOURSE_URL}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) {
      return { available: false, data: null, statusCode: res.status, error: `Recourse GET ${path} -> HTTP ${res.status}` };
    }
    return { available: true, data: body };
  } catch (err) {
    return { available: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function post<T>(path: string, payload: unknown): Promise<RecourseResult<T>> {
  try {
    const res = await fetch(`${RECOURSE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(RECOURSE_API_SECRET ? { Authorization: `Bearer ${RECOURSE_API_SECRET}` } : {}),
      },
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) {
      return { available: false, data: null, statusCode: res.status, error: `Recourse POST ${path} -> HTTP ${res.status}` };
    }
    return { available: true, data: body };
  } catch (err) {
    return { available: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// -- Health / status ---------------------------------------------------------

export interface RecourseStatusPayload {
  status: Record<string, unknown>;
  chainIntegrity?: { valid: boolean; length: number; lastHash: string };
}

export async function recourseStatus(): Promise<RecourseResult<RecourseStatusPayload>> {
  return get<RecourseStatusPayload>('/api/recourse/status');
}

// -- Recursive-math loop -----------------------------------------------------

export async function recourseMathState(): Promise<RecourseResult<{ success: boolean; state: Record<string, unknown> }>> {
  return get('/api/recourse/math/state');
}

// -- Advance the autonomous loop -------------------------------------------------
// The fleet actively drives Recourse (not just reads it): POSTing /tick advances
// one generation of the autonomous self-developer. Recourse's own safe-boot keeps
// this bounded (dream + autopilots off under RECOURSE_SAFE_BOOT=1). Honest: returns
// the real advance result, or available:false when Recourse is unreachable.

export interface RecourseTickPayload {
  success: boolean;
  systemStatus?: Record<string, unknown>;
  capabilityServed?: Record<string, unknown>;
}

export async function recourseAdvanceTick(): Promise<RecourseResult<RecourseTickPayload>> {
  return post<RecourseTickPayload>('/api/recourse/tick', {});
}

export async function recourseMathStep(): Promise<RecourseResult<{ success: boolean; result: Record<string, unknown>; state: Record<string, unknown> }>> {
  return post('/api/recourse/math/step', {});
}

// -- Lego composable-ML engine ----------------------------------------------

export async function recourseLegoState(): Promise<RecourseResult<{ success: boolean; state: Record<string, unknown> }>> {
  return get('/api/lego/state');
}

export async function recourseLegoAssemble(): Promise<RecourseResult<{ success: boolean; result: Record<string, unknown> }>> {
  return post('/api/lego/assemble', {});
}

// -- Sandboxed verifier / repair --------------------------------------------

export async function recourseVerifyCode(payload: {
  domain: string;
  sourceCode: string;
  testSuiteCode?: string;
  extra?: Record<string, unknown>;
}): Promise<RecourseResult<{ result: { passed: boolean; summary: string; score: number } }>> {
  return post('/api/recourse/verify', payload);
}

export async function recourseRepairSingle(payload: {
  toolName: string;
  brokenCode?: string;
  faultHint?: string;
}): Promise<RecourseResult<Record<string, unknown>>> {
  return post('/api/recourse/repair/single', payload);
}

// -- Template component builder ---------------------------------------------

export async function recourseBuildComponent(payload: {
  templateId: string;
  componentName?: string;
  params?: Record<string, unknown>;
  domain?: string;
}): Promise<RecourseResult<Record<string, unknown>>> {
  return post('/api/recourse/templates/build', payload);
}

export async function recourseListTemplates(): Promise<RecourseResult<{ success: boolean; count: number; templates: unknown[] }>> {
  return get('/api/recourse/templates');
}

// -- Fleet memory / recall (deeper integration) -------------------------------

export interface RecallHit {
  id?: string;
  text?: string;
  kind?: string;
  score?: number;
  [k: string]: unknown;
}

export async function recourseRecall(
  query: string,
  opts: { kind?: string; topK?: number } = {},
): Promise<RecourseResult<{ hits?: RecallHit[]; results?: RecallHit[]; matches?: RecallHit[] }>> {
  const q = new URLSearchParams({ q: query });
  if (opts.kind) q.set('kind', opts.kind);
  if (opts.topK) q.set('topK', String(opts.topK));
  return get(`/api/recourse/memory/recall?${q.toString()}`);
}

export async function recourseRegistry(): Promise<RecourseResult<Record<string, unknown>>> {
  return get('/api/recourse/registry');
}

export async function recourseSynergyMap(): Promise<RecourseResult<Record<string, unknown>>> {
  return get('/api/recourse/synergy/map');
}

export async function recourseAgendaNext(): Promise<RecourseResult<Record<string, unknown>>> {
  return get('/api/recourse/agenda/next');
}

export async function recourseUpgradeReport(): Promise<RecourseResult<Record<string, unknown>>> {
  return get('/api/recourse/system/upgrade-report');
}

/** Write a repair/loop outcome into Recourse memory (guarded; needs RECOURSE_API_SECRET). */
export async function recourseFleetMemory(payload: {
  source: string;
  goal?: string;
  status?: string;
  kind?: string;
  id?: string;
  text?: string;
  summary?: string;
  [k: string]: unknown;
}): Promise<RecourseResult<Record<string, unknown>>> {
  return post('/api/recourse/fleet/memory', payload);
}

// -- OpenSpec verify-queue (deterministic, no LLM) ----------------------------
// NOTE: `specQueue`/`verifySpec` exist ONLY in the vendored copy
// (Draymond-Orchestrator/agents/recourse), NOT in the canonical recourse server.
// Against the canonical service they honestly return available:false (HTTP 404).
// Kept for the vendored deployment; do not build fleet logic on them.

export interface SpecQueueEntry {
  name: string;
  hasProposal: boolean;
  hasDesign: boolean;
  hasTasks: boolean;
  taskCounts: { total: number; done: number };
  complete: boolean;
}

export interface SpecCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export interface SpecVerification {
  name: string;
  checks: SpecCheck[];
  passed: boolean;
}

export async function specQueue(): Promise<
  RecourseResult<{ success: boolean; changesDir: string; exists: boolean; count: number; specs: SpecQueueEntry[] }>
> {
  return get('/api/recourse/spec-queue');
}

export async function verifySpec(name: string): Promise<RecourseResult<{ success: boolean; verification: SpecVerification }>> {
  return post('/api/recourse/spec-queue/verify', { name });
}
