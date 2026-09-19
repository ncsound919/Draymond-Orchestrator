// ============================================================================
// Command Center — Brain cockpit pure helpers
// ============================================================================
// Framework-free, side-effect-free functions for the BrainPanel: severity/status
// color maps, sweep-mode labels, fallback-coverage formatting, and finding
// helpers. No React, no network, no Node APIs — importable from the client and
// the vitest suite with zero risk.
// ============================================================================

export interface CoverageLike {
  total: number;
  covered: number;
  uncovered?: string[];
  pct: number;
  degraded: boolean;
}

export interface FindingLike {
  node_id?: string;
  finding_type?: string;
  severity?: string;
  confidence?: number;
  proposed_change?: string;
  status?: string;
  component_class?: string;
}

// -- Severity / status color maps -------------------------------------------

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400',
  high: 'bg-orange-500/20 text-orange-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-blue-500/20 text-blue-400',
  info: 'bg-gray-500/20 text-gray-400',
};

/** Tailwind pill classes for a brain-finding severity; unknown falls back to gray. */
export function severityColor(severity: string | null | undefined): string {
  return SEVERITY_COLORS[severity ?? ''] ?? 'bg-gray-500/20 text-gray-400';
}

const FINDING_STATUS_COLORS: Record<string, string> = {
  open: 'bg-yellow-500/20 text-yellow-400',
  proposed: 'bg-blue-500/20 text-blue-400',
  applied: 'bg-green-500/20 text-green-400',
  resolved: 'bg-green-500/20 text-green-400',
  rejected: 'bg-gray-500/20 text-gray-400',
};

/** Tailwind pill classes for a finding's lifecycle status. */
export function findingStatusColor(status: string | null | undefined): string {
  return FINDING_STATUS_COLORS[status ?? ''] ?? 'bg-gray-500/20 text-gray-400';
}

// -- Sweep mode labels ------------------------------------------------------

const SWEEP_MODES: Record<string, string> = {
  manual: 'Manual',
  auto: 'Auto',
  daily: 'Daily',
  weekly: 'Weekly',
};

/** Human label for a brain sweep mode. */
export function sweepModeLabel(mode: string | null | undefined): string {
  return SWEEP_MODES[mode ?? ''] ?? (mode ? `${mode[0].toUpperCase()}${mode.slice(1)}` : 'Manual');
}

// -- Coverage formatting ----------------------------------------------------

/** 'covered/total (pct%)' compact label; '—' when total is 0. */
export function formatCoverage(c: CoverageLike | null | undefined): string {
  if (!c) return '—';
  if (!Number.isFinite(c.total) || c.total <= 0) return '—';
  return `${c.covered}/${c.total} (${c.pct}%)`;
}

/** True when fallback coverage is 100% of declared LLM functions. */
export function isFullCoverage(c: CoverageLike | null | undefined): boolean {
  if (!c || c.total === 0) return false;
  return c.covered >= c.total;
}

// -- Finding helpers --------------------------------------------------------

/** Sort findings by severity rank, then confidence desc. Never mutates input. */
export function sortFindings(
  findings: FindingLike[] | null | undefined,
  limit = 50,
): FindingLike[] {
  const rank: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  return [...(findings ?? [])]
    .sort((a, b) => {
      const ra = rank[a.severity ?? ''] ?? 0;
      const rb = rank[b.severity ?? ''] ?? 0;
      if (ra !== rb) return rb - ra;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    })
    .slice(0, limit);
}

/** Count findings by status bucket (open-ish vs resolved-ish). */
export function findingCounts(findings: FindingLike[] | null | undefined): {
  open: number;
  total: number;
} {
  const list = findings ?? [];
  const open = list.filter((f) => {
    const s = f.status ?? 'open';
    return s === 'open' || s === 'proposed' || s === 'applied';
  }).length;
  return { open, total: list.length };
}
