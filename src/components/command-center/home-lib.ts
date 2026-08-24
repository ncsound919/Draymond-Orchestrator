// ============================================================================
// Command Center — Home control-panel pure helpers
// ============================================================================
// Framework-free, side-effect-free functions for the HomePanel: feed merging
// and sorting, status pills, and Prometheus gauge extraction. No React, no
// network, no Node APIs — importable from client components and the vitest
// suite with zero risk.
// ============================================================================

import { relativeTime } from './fleet-lib';

// ── Feed shapes (defensive — field presence varies by API) ────────────────

export type FeedSource = 'heartbeat' | 'repair' | 'job' | 'discovery' | 'metric';

export interface FeedEntry {
  id: string;
  source: FeedSource;
  /** Short title shown in the feed row. */
  title: string;
  /** Detail line (secondary text). */
  detail: string;
  /** Sort key: ISO timestamp or epoch-ms string. Absent → treated as oldest. */
  at?: string | null;
  /** Status for pill color. */
  status?: string;
}

/** One heartbeat record as returned by /api/ops/heartbeats (map of slug→record). */
export interface HeartbeatLike {
  slug: string;
  name: string;
  last_seen: string;
  up: boolean;
  detail: string;
}

/** One repair attempt as returned by /api/ops/repair. */
export interface RepairAttemptLike {
  id: string;
  detectedAt: string;
  signal: string;
  action?: { name?: string };
  status?: string;
  detail?: string;
}

/** One job row as returned by /api/jobs. */
export interface JobFeedLike {
  id: string;
  name: string;
  last_run_at?: string | null;
  last_run_status?: string;
}

/** One discovery as returned by /api/ops/learning?include=discoveries. */
export interface DiscoveryLike {
  goalId: string;
  domain: string;
  area: string;
  title: string;
  score: number;
  evidenceTier: string;
  breakthroughClass?: string;
  trend?: string;
  gradedAt?: string;
}

// ── Epoch extraction ───────────────────────────────────────────────────────

/** Best-effort numeric sort key (ms) from a timestamp; 0 when unparseable. */
export function tsMs(at: string | null | undefined): number {
  if (!at) return 0;
  const d = new Date(at).getTime();
  return Number.isFinite(d) ? d : 0;
}

// ── Feed merging ───────────────────────────────────────────────────────────

/**
 * Merge heartbeats + repairs + jobs into a single newest-first feed capped at
 * `cap` entries. Inputs may be absent (null/undefined) — handled defensively.
 */
export function mergeFeed(
  heartbeats: HeartbeatLike[] | Record<string, HeartbeatLike> | null | undefined,
  repairs: RepairAttemptLike[] | null | undefined,
  jobs: JobFeedLike[] | null | undefined,
  cap = 50,
): FeedEntry[] {
  const entries: FeedEntry[] = [];

  // Heartbeats — normalizes either an array or a slug→record map.
  const hbList: HeartbeatLike[] = Array.isArray(heartbeats)
    ? heartbeats
    : heartbeats
      ? Object.values(heartbeats)
      : [];
  for (const h of hbList) {
    entries.push({
      id: `hb_${h.slug ?? h.name ?? entries.length}`,
      source: 'heartbeat',
      title: h.name || h.slug || 'agent',
      detail: h.up ? 'heartbeat OK' : 'no heartbeat',
      at: h.last_seen,
      status: h.up ? 'success' : 'failed',
    });
  }

  for (const r of repairs ?? []) {
    entries.push({
      id: r.id ?? `rp_${entries.length}`,
      source: 'repair',
      title: r.signal ?? 'repair',
      detail: r.detail ?? r.action?.name ?? '',
      at: r.detectedAt,
      status: r.status ?? 'escalated',
    });
  }

  for (const j of jobs ?? []) {
    entries.push({
      id: j.id ?? `job_${entries.length}`,
      source: 'job',
      title: j.name ?? 'job',
      detail: j.last_run_status ?? 'unknown',
      at: j.last_run_at ?? null,
      status: j.last_run_status ?? 'never',
    });
  }

  return entries
    .sort((a, b) => tsMs(b.at) - tsMs(a.at))
    .slice(0, cap);
}

// ── Status pills ───────────────────────────────────────────────────────────

const REPAIR_PILL: Record<string, string> = {
  applied: 'bg-green-500/20 text-green-400',
  escalated: 'bg-red-500/20 text-red-400',
  skipped: 'bg-yellow-500/20 text-yellow-400',
  fixed: 'bg-green-500/20 text-green-400',
  success: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  running: 'bg-blue-500/20 text-blue-400',
};

/** Tailwind pill classes for a feed status; unknown falls back to gray. */
export function feedStatusPill(status: string | null | undefined): string {
  return REPAIR_PILL[status ?? ''] ?? 'bg-gray-500/20 text-gray-400';
}

// ── Discovery helpers ──────────────────────────────────────────────────────

/** Short score label for a discovery (0–100 → letter-ish badge color). */
export function discoveryScoreLabel(score: number): string {
  if (score >= 80) return 'bg-emerald-500/20 text-emerald-400';
  if (score >= 60) return 'bg-blue-500/20 text-blue-400';
  if (score >= 40) return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-gray-500/20 text-gray-400';
}

/**
 * Sort discoveries newest-first by gradedAt, then by score desc. Returns a
 * fresh array; never mutates input. Cap at `limit`.
 */
export function sortDiscoveries(
  discoveries: DiscoveryLike[] | null | undefined,
  limit = 20,
): DiscoveryLike[] {
  return [...(discoveries ?? [])]
    .sort((a, b) => {
      const ta = tsMs(a.gradedAt);
      const tb = tsMs(b.gradedAt);
      if (ta !== tb) return tb - ta;
      return (b.score ?? 0) - (a.score ?? 0);
    })
    .slice(0, limit);
}

// ── Prometheus gauge extraction ────────────────────────────────────────────

export interface GaugeLike {
  name: string;
  /** Parsed key/value labels. */
  labels: Record<string, string>;
  /** Float value. */
  value: number;
}

/** Parse a Prometheus text sample body into gauges (best-effort, no throws). */
export function parsePrometheusGauges(text: string | null | undefined): GaugeLike[] {
  if (!text) return [];
  const out: GaugeLike[] = [];
  // Lines: name{label="val",label2="val2"} 123.45
  const re = /^(\w+)(\{[^}]*\})?\s+(-?\d+(?:\.\d+)?)$/gm;
  for (const m of text.matchAll(re)) {
    const [, name, labelStr, valueStr] = m;
    const labels: Record<string, string> = {};
    if (labelStr) {
      const lre = /(\w+)="([^"]*)"/g;
      for (const lm of labelStr.matchAll(lre)) labels[lm[1]] = lm[2];
    }
    const value = Number(valueStr);
    if (Number.isFinite(value)) out.push({ name, labels, value });
  }
  return out;
}

/** Number of gauges matching a name (all label sets). */
export function gaugeCount(gauges: GaugeLike[], name: string): number {
  return gauges.filter((g) => g.name === name).length;
}

/** Sum the values of all gauges matching a name. */
export function gaugeSum(gauges: GaugeLike[], name: string): number {
  return gauges.filter((g) => g.name === name).reduce((acc, g) => acc + g.value, 0);
}

/** First matching gauge's value, or `fallback`. */
export function gaugeValue(gauges: GaugeLike[], name: string, fallback = 0): number {
  return gauges.find((g) => g.name === name)?.value ?? fallback;
}

// ── Re-export for the panel ────────────────────────────────────────────────

export { relativeTime };
