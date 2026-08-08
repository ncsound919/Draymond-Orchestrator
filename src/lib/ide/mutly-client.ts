// ============================================================================
// DRAYMOND AGENT IDE — Mutly daemon client
// ============================================================================
// Talks to the Mutly developer daemon (localhost:4000). Mutly is the IDE
// engine: it indexes the workspace, extracts AST symbols, runs analysis, and
// drives the build pipeline / sandbox. All calls fail soft — an offline Mutly
// must never break a session, the session just records "mutly unavailable".
// ============================================================================

export interface MutlyHealth {
  status: string;
  timestamp?: string;
}

export interface MutlyScanStats {
  files?: number;
  total_lines?: number;
  suspicious?: number;
  [key: string]: unknown;
}

export interface MutlyAnalyzeResult {
  [key: string]: unknown;
}

export interface MutlyPipelineStartResult {
  pipelineId?: string;
  [key: string]: unknown;
}

export interface MutlyPipelineState {
  id?: string;
  status?: string;
  phase?: string;
  [key: string]: unknown;
}

export interface MutlySymbol {
  name?: string;
  kind?: string;
  file?: string;
  line?: number;
  exported?: boolean;
  [key: string]: unknown;
}

function config(): { url: string; key: string } {
  const url = process.env.MUTLY_URL ?? 'http://localhost:4000';
  return { url: url.replace(/\/+$/, ''), key: process.env.MUTLY_API_KEY ?? '' };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config().key) h['X-Mutly-API-Key'] = config().key;
  return h;
}

async function post<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(`${config().url}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Mutly ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function get<T>(path: string, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(`${config().url}${path}`, {
    method: 'GET',
    headers: headers(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Mutly ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function mutlyHealth(): Promise<MutlyHealth> {
  return get<MutlyHealth>('/api/health', 5_000);
}

export async function mutlyStatus(): Promise<Record<string, unknown>> {
  return get<Record<string, unknown>>('/api/agent/status');
}

export async function mutlyScan(): Promise<MutlyScanStats> {
  return post<MutlyScanStats>('/api/agent/scan', {});
}

export async function mutlyAnalyze(input: Record<string, unknown>): Promise<MutlyAnalyzeResult> {
  return post<MutlyAnalyzeResult>('/api/agent/analyze', input, 120_000);
}

export async function mutlySymbols(): Promise<MutlySymbol[]> {
  return get<MutlySymbol[]>('/api/agent/symbols', 60_000);
}

export async function mutlyPipelineStart(input: Record<string, unknown>): Promise<MutlyPipelineStartResult> {
  return post<MutlyPipelineStartResult>('/api/pipeline/start', input, 15_000);
}

export async function mutlyPipelineStatus(pipelineId: string): Promise<MutlyPipelineState> {
  return get<MutlyPipelineState>(`/api/pipeline/status/${encodeURIComponent(pipelineId)}`, 15_000);
}

/**
 * True when the Mutly daemon is reachable. Never throws.
 */
export async function mutlyIsUp(): Promise<boolean> {
  try {
    const h = await mutlyHealth();
    return h?.status === 'ok' || h?.status === 'up';
  } catch {
    return false;
  }
}
