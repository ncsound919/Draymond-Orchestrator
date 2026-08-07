// ============================================================================
// DRAYMOND BENCHMARK CYCLE — collect → score → record → queue weakest N
// ============================================================================
// One call per component class. Deep-scoring is opt-in via `deepScoreLimit`
// so the staggered cron only deep-scores the weakest on its Thursday run.
// ============================================================================

import { collectMetrics, getTrend, recordRun } from './benchmarking';
import { deepScore } from './deep-scorers';
import { buildWeaknessScores } from './weakness-scoring';
import { queueWeakest } from './upgrade-queue';
import { createDraymondAdminClient } from './client';
import type { ComponentClass } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchRows(supabase: any, table: string): Promise<any[]> {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
  return data ?? [];
}

/**
 * Aggregate recent event error counts per entity, keyed by entity slug.
 *
 * `draymond_events.agent_id` references `draymond_agents(id)`, but
 * `collectEntityMetrics` looks stats up by entity slug. Link agent ids back to
 * slugs via `draymond_entities.linked_agent_id` so error stats actually attach
 * to each entity. Events for agents that aren't linked to an entity are skipped.
 */
async function fetchEntityEventStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entityRows: Array<Record<string, any>>
): Promise<Record<string, { errors: number; invocations: number; avg_latency_ms: number }>> {
  const slugByAgentId: Record<string, string> = {};
  for (const row of entityRows) {
    if (row.linked_agent_id != null) slugByAgentId[String(row.linked_agent_id)] = String(row.slug);
  }

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('draymond_events')
    .select('agent_id, severity, created_at')
    .gte('created_at', since);
  if (error) throw new Error(`Failed to fetch events: ${error.message}`);
  const out: Record<string, { errors: number; invocations: number; avg_latency_ms: number }> = {};
  for (const e of (data ?? []) as Array<{ agent_id: string | null; severity: string }>) {
    if (e.agent_id == null) continue;
    const slug = slugByAgentId[e.agent_id];
    if (!slug) continue;
    out[slug] ??= { errors: 0, invocations: 0, avg_latency_ms: 0 };
    if (e.severity === 'error' || e.severity === 'critical') out[slug].errors++;
    out[slug].invocations++;
  }
  return out;
}

/**
 * Run one benchmark cycle for a component class.
 * Returns a summary the scheduler can log/notify on.
 */
export async function runBenchmarkCycle(
  componentClass: ComponentClass,
  opts: { queueLimit?: number; deepScoreLimit?: number } = {}
): Promise<{
  componentClass: ComponentClass;
  measured: number;
  recorded: number;
  weakest: Array<{ slug: string; score: number }>;
  queued: number;
  deepScored: number;
}> {
  const supabase = createDraymondAdminClient();
  const tableFor: Record<ComponentClass, string> = {
    entity: 'draymond_entities',
    site: 'draymond_site_monitors',
    cron: 'draymond_scheduled_jobs',
    chain: 'draymond_chains',
  };

  const rows = await fetchRows(supabase, tableFor[componentClass]);

  let metrics;
  if (componentClass === 'entity') {
    metrics = collectMetrics(componentClass, rows, await fetchEntityEventStats(supabase, rows));
  } else {
    metrics = collectMetrics(componentClass, rows, {});
  }

  // Compute trends from existing history.
  const trendHistory: Record<string, number[]> = {};
  for (const m of metrics) {
    trendHistory[m.component_slug] = await getTrend(componentClass, m.component_slug);
  }

  const scored = buildWeaknessScores(componentClass, metrics, trendHistory);
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const scoresMap: Record<string, number> = {};
  for (const s of scored) scoresMap[s.component_slug] = s.score;

  const { recorded } = await recordRun(componentClass, metrics, scoresMap);

  const weakest = ranked.slice(0, Math.max(1, opts.queueLimit ?? 5));

  // Deep-score only if requested (Thursday run passes deepScoreLimit > 0).
  let deepScored = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deep: Record<string, any> = {};
  if (opts.deepScoreLimit && opts.deepScoreLimit > 0) {
    deep = {};
    for (const w of weakest.slice(0, opts.deepScoreLimit)) {
      deep[w.component_slug] = await deepScore(componentClass, w.component_slug, w.component_name);
      deepScored++;
    }
  }

  const { queued } = await queueWeakest(weakest, Math.max(1, opts.queueLimit ?? 5), deep);

  return {
    componentClass,
    measured: metrics.length,
    recorded,
    weakest: weakest.map((w) => ({ slug: w.component_slug, score: w.score })),
    queued,
    deepScored,
  };
}
