/**
 * Draymond client for the Postgres/TimescaleDB gateway.
 *
 * Bridges the orchestrator (Next.js/TS) to the validated book-scan Postgres
 * artifacts (Magda Ch3/Ch5/Ch9/Ch11) served by `python/draymond_pg_gateway.py`:
 *   - queue   (Magda Ch11: Postgres-as-queue)
 *   - dag     (Magda Ch3 §3.4: recursive-CTE chain-dependency DAG)
 *   - ts      (Magda Ch9: TimescaleDB hypertables + continuous aggregates)
 *
 * The gateway runs in-memory when no DATABASE_URL is set, so this client is
 * safe to call even before a Postgres is provisioned. Until then the
 * orchestrator keeps using its existing SQLite/in-memory paths.
 */

const BASE_URL = process.env.DRAYMOND_PG_URL ?? "http://127.0.0.1:8787";

async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`DraymondPg ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${BASE_URL}${path}?${qs}` : `${BASE_URL}${path}`;
  const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`DraymondPg ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ---- queue (Magda Ch11) --------------------------------------------------
export interface QueueItem {
  msg_id: string;
  message: Record<string, unknown>;
}
export const enqueue = (message: Record<string, unknown>) =>
  post<{ msg_id: string }>("/queue/enqueue", { message });
export const dequeue = (batch_size = 1) =>
  post<{ items: QueueItem[] }>("/queue/dequeue", { batch_size });
export const complete = (ids: string[], delete_ = false) =>
  post<{ marked: number }>("/queue/complete", { ids, delete: delete_ });

// ---- dag (Magda Ch3 §3.4) ----------------------------------------------
export const addEdge = (chain_id: string, depends_on: string) =>
  post<{ added: [string, string] }>("/dag/edge", { chain_id, depends_on });
export const ancestors = (chain: string) =>
  get<{ chain: string; ancestors: [string, number][] }>("/dag/ancestors", { chain });
export const descendants = (chain: string) =>
  get<{ chain: string; descendants: [string, number][] }>("/dag/descendants", { chain });
export const dagLevels = () =>
  get<{ levels: Record<string, number> }>("/dag/levels", {});

// ---- timeseries (Magda Ch9) --------------------------------------------
export const recordSample = (agent_id: string, recorded_at: string, value: number) =>
  post<{ stored: boolean }>("/ts/sample", { agent_id, recorded_at, value });
export const createAggregate = (bucket = "5 minutes", low_threshold = 50) =>
  post<{ created: boolean }>("/ts/aggregate", { bucket, low_threshold });
export const refreshAggregate = (start: string, end: string) =>
  post<{ refreshed: boolean }>("/ts/refresh", { start, end });
export interface TsRow {
  bucket: string;
  low_count: number;
  min_value?: number;
  total?: number;
  outlier_detected: boolean;
}
export const queryWindow = (
  start: string,
  end: string,
  agent: string,
  flag_threshold = 5,
) =>
  get<{ rows: TsRow[] }>("/ts/window", {
    start,
    end,
    agent,
    flag_threshold: String(flag_threshold),
  });

export const draymondPg = {
  isReachable,
  enqueue,
  dequeue,
  complete,
  addEdge,
  ancestors,
  descendants,
  dagLevels,
  recordSample,
  createAggregate,
  refreshAggregate,
  queryWindow,
};

export default draymondPg;
