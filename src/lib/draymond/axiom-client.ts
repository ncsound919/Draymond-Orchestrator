// ============================================================================
// DRAYMOND <-> AXIOM CLIENT — authenticated codegen + Recourse bridge
// ============================================================================
// Axiom is the fleet's coding engine AND the deepest Recourse integration in
// the stack. This module owns the shared HS256 auth (minted from Keywire's
// jwtSecret, aud "axiom-api" — the same secret Axiom verifies) and the bridge
// endpoints the repair crew uses:
//
//   codegen chat        POST /v1/chat/completions            (route: auto|local|...)
//   Recourse exemplars  GET  /api/recourse/bridge/exemplars?goal=...
//   Recourse context    GET  /api/recourse/bridge/context?goal=...
//   project-loop repair POST /api/recourse/bridge/repair     (real edits + tests + rollback)
//   outcome write-back  POST /api/recourse/bridge/outcome
//   code-pattern write  POST /api/recourse/bridge/code-pattern
//   stack verify        POST /api/ops/stack-verify
//
// Every call is fail-soft: `{ ok:false, error }` on any failure, never throws.
// No fabricated results — an unreachable Axiom is reported as unreachable.
// ============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';

export const AXIOM_URL = (
  process.env.AXIOM_URL ?? `http://127.0.0.1:${process.env.AXIOM_PORT ?? 3198}`
).replace(/\/+$/, '');

const KEYWIRE_KEYS_FILE =
  process.env.KEYWIRE_KEYS_FILE ??
  'C:/Users/User/Downloads/Uplift/Keywire/data/keywire-keys.json';

const DEFAULT_TIMEOUT_MS = Number(process.env.AXIOM_TIMEOUT_MS) || 30_000;

/** Read Keywire's shared HMAC secret. "" when absent — callers fail closed. */
function loadJwtSecret(): string {
  try {
    if (!/*turbopackIgnore: true*/ fs.existsSync(KEYWIRE_KEYS_FILE)) return '';
    const raw = JSON.parse(/*turbopackIgnore: true*/ fs.readFileSync(KEYWIRE_KEYS_FILE, 'utf-8')) as { jwtSecret?: unknown };
    return typeof raw?.jwtSecret === 'string' ? raw.jwtSecret : '';
  } catch {
    return '';
  }
}

const b64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url');

/** Sign an HS256 JWT in the shape Keywire/Axiom verify (aud "axiom-api"). */
export function mintAxiomToken(secret: string, subject = 'draymond', ttlSeconds = 300): string {
  const nowS = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ sub: subject, iss: 'draymond-orchestrator', aud: 'axiom-api', iat: nowS, exp: nowS + ttlSeconds }),
  );
  const input = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${sig}`;
}

/** Auth headers for Axiom. Empty when no secret is configured (auth disabled). */
export function axiomAuthHeaders(): Record<string, string> {
  const secret = loadJwtSecret();
  if (!secret) return {};
  return { Authorization: `Bearer ${mintAxiomToken(secret)}` };
}

export interface AxiomFetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

/** Authenticated JSON call to Axiom. Never throws. */
export async function axiomFetch<T>(
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {},
): Promise<AxiomFetchResult<T>> {
  const method = opts.method ?? 'GET';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const res = await fetch(`${AXIOM_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...axiomAuthHeaders(),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) {
      return { ok: false, status: res.status, data, error: `axiom ${method} ${path} -> HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Is Axiom reachable? Public /api/health (no auth). */
export async function axiomOnline(timeoutMs = 2000): Promise<boolean> {
  const r = await axiomFetch<unknown>('/api/health', { timeoutMs });
  return r.ok;
}

// -- Recourse bridge ---------------------------------------------------------

export interface AxiomExemplarResult {
  ok: boolean;
  count: number;
  block: string;
  error?: string;
}

/**
 * Verified prior art for a coding goal. `block` is the ready-to-inject prompt
 * text; empty when Recourse has nothing (or is offline).
 */
export async function axiomExemplars(
  goal: string,
  opts: { domain?: string; max?: number; timeoutMs?: number } = {},
): Promise<AxiomExemplarResult> {
  const q = new URLSearchParams({ goal });
  if (opts.domain) q.set('domain', opts.domain);
  if (opts.max) q.set('max', String(opts.max));
  const r = await axiomFetch<{ count?: number; block?: string; exemplars?: unknown[] }>(
    `/api/recourse/bridge/exemplars?${q.toString()}`,
    { timeoutMs: opts.timeoutMs ?? 4000 },
  );
  return {
    ok: r.ok,
    count: r.data?.count ?? 0,
    block: typeof r.data?.block === 'string' ? r.data.block : '',
    ...(r.error ? { error: r.error } : {}),
  };
}

/** Compact planner context for a goal (prior lessons + synergy domains). */
export async function axiomRecourseContext(goal: string, timeoutMs = 4000): Promise<string> {
  const r = await axiomFetch<{ context?: string }>(
    `/api/recourse/bridge/context?goal=${encodeURIComponent(goal)}`,
    { timeoutMs },
  );
  return typeof r.data?.context === 'string' ? r.data.context : '';
}

export interface AxiomProjectRepairResult {
  ok: boolean;
  id?: string;
  maxIterations?: number;
  error?: string;
}

/**
 * Hand Axiom a real project loop to repair `targetDir`. This is the substantive
 * repair path: Axiom edits files, runs typecheck + the repo's real tests,
 * verifies against Recourse's sandbox, and rolls back on failure. Draymond only
 * records the loop id; Axiom writes the outcome back (and calls Draymond's
 * repair-triage if the loop fails).
 */
export async function axiomProjectRepair(input: {
  goal: string;
  targetDir: string;
  findings?: Array<Record<string, unknown>>;
  maxIterations?: number;
  timeoutMs?: number;
}): Promise<AxiomProjectRepairResult> {
  const r = await axiomFetch<{ id?: string; maxIterations?: number; error?: string }>(
    '/api/recourse/bridge/repair',
    {
      method: 'POST',
      body: {
        goal: input.goal,
        targetDir: input.targetDir,
        findings: input.findings ?? [],
        ...(input.maxIterations ? { maxIterations: input.maxIterations } : {}),
      },
      timeoutMs: input.timeoutMs ?? 15_000,
    },
  );
  if (!r.ok) return { ok: false, error: r.error ?? `HTTP ${r.status}` };
  return { ok: true, id: r.data?.id, maxIterations: r.data?.maxIterations };
}

/** Feed a repair outcome into Recourse memory (Axiom guards + forwards it). */
export async function axiomWriteOutcome(payload: {
  goal: string;
  status: string;
  iteration?: number;
  maxIterations?: number;
  targetDir?: string;
  findings?: string[];
}): Promise<boolean> {
  const r = await axiomFetch('/api/recourse/bridge/outcome', {
    method: 'POST',
    body: payload,
    timeoutMs: 5000,
  });
  return r.ok;
}

/** Promote a verified fix into Recourse as recallable prior art. */
export async function axiomWriteCodePattern(payload: {
  name: string;
  goal: string;
  source: string;
  suite?: string;
  domain?: string;
  gate?: string;
  targetDir?: string;
}): Promise<boolean> {
  const r = await axiomFetch('/api/recourse/bridge/code-pattern', {
    method: 'POST',
    body: payload,
    timeoutMs: 5000,
  });
  return r.ok;
}

/** Run Axiom's stack-aware verification over a workspace dir. */
export async function axiomStackVerify(
  dir: string,
  timeoutMs = 120_000,
): Promise<AxiomFetchResult<Record<string, unknown>>> {
  return axiomFetch<Record<string, unknown>>('/api/ops/stack-verify', {
    method: 'POST',
    body: { dir },
    timeoutMs,
  });
}
