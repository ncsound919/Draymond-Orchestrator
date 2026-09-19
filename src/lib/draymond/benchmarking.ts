// ============================================================================
// DRAYMOND BENCHMARKING — collect, record, and trend component metrics
// ============================================================================
// Reads existing Draymond state (entities, site monitors, scheduled jobs,
// chains) and records per-run snapshots to draymond_benchmarks so the weakest
// components can be found and upgraded over time.
// ============================================================================

import { createDraymondAdminClient } from './client';
import type { BenchmarkMetric, ComponentClass, DeepScoreResult } from './types';

// -- Run id ------------------------------------------------------------------

export function buildRunId(componentClass: ComponentClass, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${componentClass}-${stamp}`;
}

// -- Slug helpers (mirror the existing registry slug conventions) -----------

function toSlug(name: string): string {
  // Cap at 64 chars (component_slug is text but stays comfortably under
  // typical URL/label limits) and fall back to 'unknown' for empty names.
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug || 'unknown';
}

// -- Collection --------------------------------------------------------------

/**
 * Collect metrics for one component class from raw rows.
 * Rows are `unknown` because callers pass Supabase-typed rows or plain test
 * fixtures. Evidence strings make every metric auditable.
 */
export function collectMetrics(
  componentClass: ComponentClass,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: Array<Record<string, any>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extras: Record<string, any>
): BenchmarkMetric[] {
  switch (componentClass) {
    case 'site':
      return collectSiteMetrics(rows);
    case 'cron':
      return collectCronMetrics(rows);
    case 'entity':
      return collectEntityMetrics(rows, extras);
    case 'chain':
      return collectChainMetrics(rows);
    default:
      throw new Error('Unknown component class: ' + componentClass);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectSiteMetrics(rows: Array<Record<string, any>>): BenchmarkMetric[] {
  return rows.map((r) => {
    const failures = Number(r.consecutive_failures ?? 0);
    const status = String(r.current_status ?? 'unknown');
    const latency = r.last_response_time_ms != null ? Number(r.last_response_time_ms) : null;
    return {
      component_class: 'site',
      component_slug: toSlug(r.metadata?.slug ?? r.name),
      component_name: String(r.name),
      metrics: {
        status,
        failures,
        latency_ms: latency,
        // Treat anything other than 'up' as 0% uptime for the run snapshot.
        uptime_pct: status === 'up' ? 100 : 0,
        check_interval_seconds: Number(r.check_interval_seconds ?? 300),
      },
      evidence: `monitor ${r.name} status=${status} failures=${failures} latency=${latency ?? 'n/a'}`,
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectCronMetrics(rows: Array<Record<string, any>>): BenchmarkMetric[] {
  return rows.map((r) => {
    const runCount = Number(r.run_count ?? 0);
    const failCount = Number(r.fail_count ?? 0);
    const failureRate = runCount > 0 ? failCount / runCount : 0;
    return {
      component_class: 'cron',
      component_slug: toSlug(r.name),
      component_name: String(r.name),
      metrics: {
        last_run_status: String(r.last_run_status ?? 'never'),
        run_count: runCount,
        fail_count: failCount,
        failure_rate: Number(failureRate.toFixed(4)),
        duration_ms: r.last_run_duration_ms != null ? Number(r.last_run_duration_ms) : null,
      },
      evidence: r.last_error ? `last_error: ${String(r.last_error)}` : `last_run: ${String(r.last_run_status ?? 'never')}`,
    };
  });
}

function collectEntityMetrics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: Array<Record<string, any>>,
  events: Record<string, { errors?: number; invocations?: number; avg_latency_ms?: number }>
): BenchmarkMetric[] {
  return rows.map((r) => {
    const slug = String(r.slug);
    const e = events[slug] ?? {};
    const invocations = Number(e.invocations ?? 0);
    const errors = Number(e.errors ?? 0);
    const errorRate = invocations > 0 ? errors / invocations : 0;
    const invokedAt = r.last_invoked_at ? new Date(r.last_invoked_at).getTime() : 0;
    const stalenessDays = invokedAt ? (Date.now() - invokedAt) / 86_400_000 : Infinity;
    return {
      component_class: 'entity',
      component_slug: slug,
      component_name: String(r.name ?? slug),
      metrics: {
        health_status: String(r.health_status ?? 'unknown'),
        invocations,
        errors,
        error_rate: Number(errorRate.toFixed(4)),
        avg_latency_ms: Number(e.avg_latency_ms ?? 0),
        staleness_days: Number.isFinite(stalenessDays) ? Number(stalenessDays.toFixed(1)) : null,
      },
      evidence: `entity ${slug} health=${String(r.health_status ?? 'unknown')} errors=${errors}/${invocations} latency=${e.avg_latency_ms ?? 'n/a'}`,
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectChainMetrics(rows: Array<Record<string, any>>): BenchmarkMetric[] {
  return rows.map((r) => {
    const total = Number(r.total_steps ?? 0);
    const failed = Number(r.failed_steps ?? 0);
    const failedStepRate = total > 0 ? failed / total : 0;
    return {
      component_class: 'chain',
      component_slug: toSlug(r.slug ?? r.name),
      component_name: String(r.name ?? r.slug),
      metrics: {
        status: String(r.status ?? 'unknown'),
        total_steps: total,
        failed_steps: failed,
        failed_step_rate: Number(failedStepRate.toFixed(4)),
        duration_ms: r.total_duration_ms != null ? Number(r.total_duration_ms) : null,
      },
      evidence: `chain ${r.name} status=${String(r.status ?? 'unknown')} failed_steps=${failed}/${total}`,
    };
  });
}

// -- Recording ---------------------------------------------------------------

/**
 * Insert a batch of metrics under one run_id.
 * Returns the number of rows written.
 */
export async function recordRun(
  componentClass: ComponentClass,
  metrics: BenchmarkMetric[],
  scores?: Record<string, number>,
  runId = buildRunId(componentClass)
): Promise<{ run_id: string; recorded: number }> {
  if (metrics.length === 0) return { run_id: runId, recorded: 0 };
  const supabase = createDraymondAdminClient();
  const rows = metrics.map((m) => ({
    run_id: runId,
    component_class: m.component_class,
    component_slug: m.component_slug,
    component_name: m.component_name,
    metrics: m.metrics,
    weakness_score: scores?.[m.component_slug] ?? 0,
    evidence: m.evidence,
  }));
  const { error } = await supabase.from('draymond_benchmarks').insert(rows).select();
  if (error) throw new Error(`Failed to record benchmarks: ${error.message}`);
  return { run_id: runId, recorded: rows.length };
}

/**
 * Persist RepoRank / Grader / Vibe-Reality deep scores onto the benchmark rows
 * of a just-completed run. Deep scores are attached after recording because the
 * deep-scorers only run on the weakest N components (opt-in per cycle).
 * Keyed by component_slug; rows without a score are left untouched.
 */
export async function recordDeepScores(
  runId: string,
  componentClass: ComponentClass,
  deepScores: Record<string, Record<string, DeepScoreResult>>
): Promise<number> {
  const entries = Object.entries(deepScores);
  if (entries.length === 0) return 0;
  const supabase = createDraymondAdminClient();
  let updated = 0;
  for (const [slug, results] of entries) {
    const { error } = await supabase
      .from('draymond_benchmarks')
      .update({ deep_scores: results })
      .eq('run_id', runId)
      .eq('component_class', componentClass)
      .eq('component_slug', slug);
    if (error) throw new Error(`Failed to record deep scores for ${slug}: ${error.message}`);
    updated++;
  }
  return updated;
}

// -- Trend -------------------------------------------------------------------

/** Return the most recent `limit` weakness scores for a component, oldest-first. */
export async function getTrend(
  componentClass: ComponentClass,
  componentSlug: string,
  limit = 10
): Promise<number[]> {
  const safe = Math.min(Math.max(1, limit), 100);
  const supabase = createDraymondAdminClient();
  const { data, error } = await supabase
    .from('draymond_benchmarks')
    .select('weakness_score')
    .eq('component_class', componentClass)
    .eq('component_slug', componentSlug)
    .order('run_at', { ascending: false })
    .limit(safe);
  if (error) throw new Error(`Failed to fetch trend: ${error.message}`);
  return (data ?? []).map((r: { weakness_score: number }) => Number(r.weakness_score)).reverse();
}
