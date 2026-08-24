// ============================================================================
// Command Center — Science (CureMind / biotech) pure helpers
// ============================================================================
// Framework-free, side-effect-free functions for the SciencePanel: goal /
// experiment status pills, type labels, priority labels, and numeric clamps.
// No React, no network, no Node APIs — importable from the client and vitest.
// ============================================================================

export interface GoalLike {
  id: string;
  title?: string;
  domain?: string;
  status?: string;
  priority?: number;
  area?: string;
}

export interface ExperimentLike {
  id: string;
  goal_id?: string;
  domain?: string;
  type?: string;
  status?: string;
  title?: string;
  created_at?: string;
}

export interface DiscoveryLike {
  goalId: string;
  title?: string;
  score?: number;
  domain?: string;
  area?: string;
  evidenceTier?: string;
  breakthroughClass?: string;
}

// ── Goal status pills ──────────────────────────────────────────────────────

const GOAL_STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-blue-500/20 text-blue-400',
  archived: 'bg-gray-500/20 text-gray-400',
};

/** Tailwind pill classes for a science goal status. */
export function goalStatusPill(status: string | null | undefined): string {
  return GOAL_STATUS_COLORS[status ?? ''] ?? 'bg-gray-500/20 text-gray-400';
}

// ── Experiment status / type pills ─────────────────────────────────────────

const EXPERIMENT_STATUS_COLORS: Record<string, string> = {
  queued: 'bg-blue-500/20 text-blue-400',
  running: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  cancelled: 'bg-gray-500/20 text-gray-400',
};

/** Tailwind pill classes for an experiment's run status. */
export function experimentStatusPill(status: string | null | undefined): string {
  return EXPERIMENT_STATUS_COLORS[status ?? ''] ?? 'bg-gray-500/20 text-gray-400';
}

const EXPERIMENT_TYPE_LABELS: Record<string, string> = {
  analysis: 'Analysis',
  simulation: 'Simulation',
  translation: 'Translation',
  sports: 'Sports',
  biotech: 'Biotech',
};

/** Human label for an experiment type/domain. */
export function experimentTypeLabel(type: string | null | undefined): string {
  return EXPERIMENT_TYPE_LABELS[type ?? ''] ?? (type ?? '—');
}

// ── Priority labels ────────────────────────────────────────────────────────

/** Descriptive label for a numeric priority score. */
export function priorityLabel(priority: number | null | undefined): string {
  if (priority == null || !Number.isFinite(priority)) return '—';
  if (priority >= 80) return 'Critical';
  if (priority >= 60) return 'High';
  if (priority >= 40) return 'Medium';
  if (priority >= 20) return 'Low';
  return 'Minimal';
}

/** Pill classes for a priority band. */
export function priorityPill(priority: number | null | undefined): string {
  if (priority == null || !Number.isFinite(priority)) return 'bg-gray-500/20 text-gray-400';
  if (priority >= 80) return 'bg-red-500/20 text-red-400';
  if (priority >= 60) return 'bg-orange-500/20 text-orange-400';
  if (priority >= 40) return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-blue-500/20 text-blue-400';
}

// ── Discovery helpers ──────────────────────────────────────────────────────

/** Score badge classes for a discovery. */
export function discoveryPill(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return 'bg-gray-500/20 text-gray-400';
  if (score >= 80) return 'bg-emerald-500/20 text-emerald-400';
  if (score >= 60) return 'bg-blue-500/20 text-blue-400';
  if (score >= 40) return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-gray-500/20 text-gray-400';
}

/** Sort discoveries by score desc; never mutates input. */
export function sortDiscoveriesByScore(
  discoveries: DiscoveryLike[] | null | undefined,
  limit = 12,
): DiscoveryLike[] {
  return [...(discoveries ?? [])]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

// ── Numeric clamps (pure) ──────────────────────────────────────────────────

/** Clamp simulation ticks into a sane range (1–10000); NaN → default. */
export function clampTicks(n: number, def = 100): number {
  if (!Number.isFinite(n)) return def;
  return Math.min(10_000, Math.max(1, Math.round(n)));
}

/** Clamp a sim param into [min, max]; NaN → fallback. */
export function clampParam(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
