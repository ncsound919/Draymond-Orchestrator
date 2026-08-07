// ============================================================================
// DRAYMOND WEAKNESS SCORING — weighted composite per component class
// ============================================================================
// 0 = healthy, 100 = worst. Weights differ per class so a site's uptime and a
// cron's failure rate are both meaningful. Every reason string is derived from
// the metric evidence — no fabricated numbers.
// ============================================================================

import type { BenchmarkMetric, ComponentClass, WeaknessScore } from './types';

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Normalize latency against a per-class budget. */
function latencyPenalty(latencyMs: number | null | undefined, budgetMs: number): number {
  if (latencyMs == null) return 0;
  return clamp01(latencyMs / budgetMs) * 100;
}

/** Penalty for stale/no recent activity. */
function stalenessPenalty(stalenessDays: number | null | undefined, thresholdDays: number): number {
  if (stalenessDays == null) return 0;
  return clamp01(Math.max(0, stalenessDays - 3) / thresholdDays) * 100;
}

export function scoreMetrics(
  componentClass: ComponentClass,
  metric: BenchmarkMetric
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (componentClass === 'site') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = metric.metrics as Record<string, any>;
    const status = String(m.status ?? 'unknown');
    const failures = Number(m.failures ?? 0);
    const uptime = Number(m.uptime_pct ?? 0);
    const statusPenalty = status === 'down' ? 100 : status === 'degraded' ? 50 : 0;
    const failPenalty = clamp01(failures / 3) * 60;
    const latencyPen = latencyPenalty(m.latency_ms, 2000);
    // uptime_pct is binary from the collector (100 = 'up', 0 otherwise), so
    // 0.1 * (100 - uptime_pct) is a flat 10 when the site is down.
    score = 0.4 * statusPenalty + 0.3 * failPenalty + 0.2 * latencyPen + 0.1 * (100 - uptime);
    if (statusPenalty > 0) reasons.push(`${status} status`);
    if (failPenalty > 0) reasons.push(`${failures} consecutive failures`);
    if (latencyPen >= 100) reasons.push(`latency ${m.latency_ms}ms exceeds 2s budget`);
  } else if (componentClass === 'cron') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = metric.metrics as Record<string, any>;
    const failRate = Number(m.failure_rate ?? 0);
    const duration = m.duration_ms != null ? Number(m.duration_ms) : null;
    const lastStatus = String(m.last_run_status ?? 'never');
    const failRatePenalty = clamp01(failRate) * 100;
    const durationPen = latencyPenalty(duration, 60_000);
    const recencyPenalty = lastStatus === 'failed' ? 50 : lastStatus === 'never' ? 30 : 0;
    // failure rate weighs 0.55 (0.4 primary + 0.15 robustness)
    score = 0.55 * failRatePenalty + 0.25 * recencyPenalty + 0.2 * durationPen;
    if (failRate > 0.3) reasons.push(`failure rate ${(failRate * 100).toFixed(0)}%`);
    if (lastStatus === 'failed') reasons.push('last run failed');
    if (durationPen >= 100) reasons.push(`duration ${duration}ms exceeds 60s budget`);
  } else if (componentClass === 'entity') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = metric.metrics as Record<string, any>;
    const errorRate = Number(m.error_rate ?? 0);
    const latency = Number(m.avg_latency_ms ?? 0);
    const health = String(m.health_status ?? 'unknown');
    const staleness = m.staleness_days != null ? Number(m.staleness_days) : null;
    const errorPenalty = clamp01(errorRate) * 100;
    const latencyPen = latencyPenalty(latency, 3000);
    const healthPenalty = health === 'crashed' ? 100 : health === 'stalled' ? 80 : health === 'degraded' ? 50 : 0;
    const stalePen = stalenessPenalty(staleness, 14);
    score = 0.4 * errorPenalty + 0.25 * healthPenalty + 0.2 * latencyPen + 0.15 * stalePen;
    if (errorRate > 0.3) reasons.push(`error rate ${(errorRate * 100).toFixed(0)}%`);
    if (healthPenalty > 0) reasons.push(`${health} health`);
    if (stalePen > 40) reasons.push(`stale (${staleness} days since invocation)`);
  } else if (componentClass === 'chain') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = metric.metrics as Record<string, any>;
    const failedStepRate = Number(m.failed_step_rate ?? 0);
    const duration = m.duration_ms != null ? Number(m.duration_ms) : null;
    const status = String(m.status ?? 'unknown');
    const failPenalty = clamp01(failedStepRate) * 100;
    const durationPen = latencyPenalty(duration, 120_000);
    const statusPenalty = status === 'failed' ? 100 : status === 'running' ? 40 : 0;
    // failure rate weighs 0.55 (0.4 primary + 0.15 robustness)
    score = 0.55 * failPenalty + 0.25 * statusPenalty + 0.2 * durationPen;
    if (failedStepRate > 0.3) reasons.push(`${(failedStepRate * 100).toFixed(0)}% failed steps`);
    if (statusPenalty > 0) reasons.push(`chain status ${status}`);
    if (durationPen >= 100) reasons.push(`duration ${duration}ms exceeds 2m budget`);
  } else {
    throw new Error('Unknown component class: ' + componentClass);
  }

  // Always explain the score: a healthy component gets a derived all-clear
  // reason instead of an empty list.
  if (reasons.length === 0) reasons.push('no weaknesses detected');

  return { score: Math.round(clamp(score)), reasons };
}

/** Trend from a weakness-score history (oldest → newest). */
export function classifyTrend(history: number[]): 'improving' | 'flat' | 'worsening' {
  if (history.length < 2) return 'flat';
  const first = history[0];
  const last = history[history.length - 1];
  const delta = last - first;
  if (delta > 5) return 'worsening';
  if (delta < -5) return 'improving';
  return 'flat';
}

export function buildWeaknessScores(
  componentClass: ComponentClass,
  metrics: BenchmarkMetric[],
  trendHistory: Record<string, number[]>
): WeaknessScore[] {
  return metrics.map((m) => {
    const { score, reasons } = scoreMetrics(componentClass, m);
    return {
      component_class: componentClass,
      component_slug: m.component_slug,
      component_name: m.component_name,
      score,
      reasons,
      trend: classifyTrend(trendHistory[m.component_slug] ?? []),
    };
  });
}
