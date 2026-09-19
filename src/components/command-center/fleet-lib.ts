// ============================================================================
// Command Center — Fleet (Home / Agents / Tasks / Brain) pure helpers
// ============================================================================
// Framework-free, side-effect-free functions shared by the HomePanel,
// AgentsPanel, TasksPanel, and BrainPanel and their vitest suite. No React,
// no network, no server, no Node APIs — import anywhere (client, tests,
// scripts) with zero risk.
// ============================================================================

export type DayPhase = 'morning' | 'midday' | 'evening' | 'night';

export const DAY_PHASES: DayPhase[] = ['morning', 'midday', 'evening', 'night'];

/** The four orchestrated day phases, in run order. */
export function phaseList(): DayPhase[] {
  return [...DAY_PHASES];
}

// -- Fleet shapes (defensive — field presence varies by API) ---------------

export interface FleetAgent {
  id: string;
  name: string;
  capabilities: string[];
  status: string;
  last_heartbeat: string | null;
  avatar_url: string | null;
}

export interface JobLike {
  id: string;
  name: string;
  job_type?: string;
  cron_expression?: string;
  is_enabled?: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_run_status?: string;
}

export interface ChainLike {
  id: string;
  name: string;
  status: string;
  is_template?: boolean;
  total_steps?: number;
  completed_steps?: number;
}

export interface DayPlanStep {
  id: string;
  phase: DayPhase;
  time: string;
  job: string;
  purpose: string;
  feedsTo?: string[];
  durationMs?: number;
  tokenBudget?: number;
}

export interface DayPlanResponse {
  phase?: DayPhase;
  steps?: DayPlanStep[];
  nextDue?: DayPlanStep | null;
  byPhase?: Partial<Record<DayPhase, DayPlanStep[]>>;
  totalSteps?: number;
  phaseBudgets?: Partial<Record<DayPhase, number>>;
}

export interface PhaseRunResult {
  phase?: DayPhase;
  executed?: string[];
  errors?: string[];
  dropped?: string[];
  estimated_tokens?: number;
}

export interface BrainStatusLike {
  last_run_at?: string | null;
  last_run?: Record<string, unknown> | null;
  total_findings?: number;
  open_findings?: number;
  communities?: string[];
  ledger_path?: string;
  mode?: string;
  degraded_mode?: boolean;
  fallback_coverage?: number | null;
}

export interface BrainAgendaItem {
  title?: string;
  progress?: number;
  status?: string;
}

export interface BrainPayload {
  agenda?: BrainAgendaItem[] | null;
  brain?: BrainStatusLike | null;
}

export interface BrainDecisionResult {
  generatedAt?: string;
  brainConsulted?: boolean;
  focusGoal?: string | null;
  priorities?: Array<{ id: string; label: string; why: string; agent: string }>;
  repairQueue?: Array<{ signal: string; detail: string; kind: string; priority: number }>;
  actions?: Array<{ action: string; detail: string; ok: boolean }>;
}

// -- Status color maps -----------------------------------------------------

const STATUS_DOT_COLORS: Record<string, string> = {
  active: 'bg-green-500',
  degraded: 'bg-yellow-500',
  stalled: 'bg-orange-500',
  crashed: 'bg-red-500',
  recovering: 'bg-blue-500',
  suspended: 'bg-gray-500',
  terminated: 'bg-gray-700',
};

/** Tailwind dot color for an agent status; anything unknown falls back to gray. */
export function statusColor(status: string | null | undefined): string {
  if (!status) return 'bg-gray-500';
  return STATUS_DOT_COLORS[status] ?? 'bg-gray-500';
}

const CHAIN_STATUS_BADGES: Record<string, string> = {
  running: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  active: 'bg-emerald-500/20 text-emerald-400',
  draft: 'bg-gray-500/20 text-gray-400',
  cancelled: 'bg-gray-500/20 text-gray-400',
  archived: 'bg-gray-500/20 text-gray-400',
};

/** Tailwind pill classes for a chain status; unknown falls back to gray. */
export function chainStatusBadge(status: string | null | undefined): string {
  return CHAIN_STATUS_BADGES[status ?? ''] ?? 'bg-gray-500/20 text-gray-400';
}

const JOB_STATUS_BADGES: Record<string, string> = {
  success: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  running: 'bg-blue-500/20 text-blue-400',
  never: 'bg-gray-500/20 text-gray-400',
  skipped: 'bg-yellow-500/20 text-yellow-400',
  recovered: 'bg-blue-500/20 text-blue-400',
};

/** Tailwind pill classes for a job's last-run status; unknown falls back to gray. */
export function jobStatusBadge(status: string | null | undefined): string {
  return JOB_STATUS_BADGES[status ?? ''] ?? 'bg-gray-500/20 text-gray-400';
}

// -- Counts ----------------------------------------------------------------

/** Number of enabled jobs in a list (defensive: missing flag → not enabled). */
export function jobEnabledCount(
  jobs: Array<{ is_enabled?: boolean }> | null | undefined,
): number {
  return (jobs ?? []).filter((j) => j.is_enabled === true).length;
}

/** Number of agents currently reporting 'active'. */
export function agentHealthyCount(
  agents: Array<{ status?: string }> | null | undefined,
): number {
  return (agents ?? []).filter((a) => a.status === 'active').length;
}

// -- Time formatting -------------------------------------------------------

/** Compact relative timestamp ('2m ago'); 'Never' for null/absent/unparseable. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'Never';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Short 'Jan 5 08:00' label; '--' for null/absent/unparseable. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// -- Brain health ----------------------------------------------------------

export type BrainHealth = 'online' | 'degraded' | 'offline';

/**
 * Coarse brain status from the /api/ops/brain payload. Null payload → offline.
 * A brain with no recorded run or a stale run (>24h) → degraded, else online.
 */
export function brainHealth(brain: BrainStatusLike | null | undefined): BrainHealth {
  if (!brain) return 'offline';
  if (!brain.last_run_at) return 'degraded';
  const t = new Date(brain.last_run_at).getTime();
  if (!Number.isFinite(t)) return 'degraded';
  const ageMs = Date.now() - t;
  if (ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000) return 'online';
  return 'degraded';
}
