// ============================================================================
// Command Center — Sites & Science pure helpers
// ============================================================================
// Framework-free, side-effect-free functions shared by the SitesPanel and
// SciencePanel and their vitest suite. No React, no network, no server, no
// Node APIs — import anywhere (client, tests, scripts) with zero risk.
// ============================================================================

export interface MonitorLike {
  id?: string;
  name?: string;
  url?: string;
  check_interval_seconds?: number;
  expected_status_code?: number;
  timeout_ms?: number;
  is_enabled?: boolean;
  current_status?: string | null;
  last_check_at?: string | null;
  last_response_time_ms?: number | null;
  consecutive_failures?: number;
  notify_on_down?: boolean;
  notify_on_recovery?: boolean;
}

const STATUS_DOT_COLORS: Record<string, string> = {
  up: 'bg-green-500',
  down: 'bg-red-500',
  degraded: 'bg-yellow-500',
  unknown: 'bg-gray-500',
};

/** Tailwind dot color for a monitor status; anything unknown falls back to gray. */
export function monitorStatusColor(status: string | null | undefined): string {
  if (!status) return STATUS_DOT_COLORS.unknown;
  return STATUS_DOT_COLORS[status] ?? STATUS_DOT_COLORS.unknown;
}

/** True when the monitor's current status is exactly 'down'. */
export function monitorIsDown(
  m: Pick<MonitorLike, 'current_status'> | null | undefined,
): boolean {
  return m?.current_status === 'down';
}

const SOURCE_LABELS: Record<string, string> = {
  openalex: 'OpenAlex',
  pubmed: 'PubMed',
};

/** Human label for a paper source; unknown sources pass through unchanged. */
export function paperSourceLabel(source: string | null | undefined): string {
  if (!source) return 'Unknown';
  return SOURCE_LABELS[source] ?? source;
}

/**
 * Format a response time in milliseconds as a short human string.
 * - null / undefined / NaN → '--'
 * - < 1000ms → '120ms'
 * - otherwise → '1.2s' (one decimal)
 */
export function formatResponseTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Relative "Last check" label ('2m ago') — 'Never' when there is no timestamp. */
export function formatLastCheck(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'Never';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface DeployLike {
  ok?: boolean;
  message?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  durationMs?: number | null;
}

/**
 * Short one-line summary of a deploy result for toasts/status lines.
 * Success: 'Deploy succeeded (1.2s)'. Failure: 'Deploy failed: <reason>'.
 * Strips a duplicate leading "Deploy failed:" from the provider message.
 */
export function deploySummary(result: DeployLike | null | undefined): string {
  if (!result) return 'Deploy unavailable';
  const duration =
    result.durationMs !== null && result.durationMs !== undefined
      ? ` (${formatResponseTime(result.durationMs)})`
      : '';
  if (result.ok) return `Deploy succeeded${duration}`;
  const stripped = (result.message ?? '').trim().replace(/^(?:deploy failed:\s*)+/i, '');
  const reason = stripped || 'unknown error';
  return `Deploy failed: ${reason}`;
}

export interface PaperLike {
  id?: string;
  source?: string | null;
  title?: string;
  url?: string;
  year?: string | number | null;
  authors?: string | null;
  summary?: string;
}

/**
 * Flatten the `Record<goalKey, Paper[]>` response into an ordered array of
 * non-empty groups. Renders defensively: null/undefined/non-array entries and
 * empty groups are dropped.
 */
export function papersByGoal(
  record: Record<string, PaperLike[]> | null | undefined,
): Array<{ goal: string; papers: PaperLike[] }> {
  if (!record) return [];
  return Object.entries(record)
    .map(([goal, papers]) => ({ goal, papers: Array.isArray(papers) ? papers : [] }))
    .filter((g) => g.papers.length > 0);
}

/** Extract a 4-digit year for display ('2024 Feb 03' → '2024'); '—' when absent. */
export function paperYearLabel(year: string | number | null | undefined): string {
  if (year === null || year === undefined || year === '') return '—';
  if (typeof year === 'number') return String(year);
  const trimmed = String(year).trim();
  if (!trimmed) return '—';
  const match = trimmed.match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : trimmed;
}
