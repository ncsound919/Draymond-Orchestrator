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
import type { ComponentClass, DeepScoreResult } from './types';

// PostgREST caps a bare `select('*')` at 1000 rows (`db-max-rows`) and
// silently truncates anything beyond it. Explicitly pin the limit to 1000 so
// truncation is at least deterministic; pagination is a future enhancement.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchRows(supabase: any, table: string): Promise<any[]> {
  // 1000-row PostgREST cap; pagination is a future enhancement (see above).
  const { data, error } = await supabase.from(table).select('*').limit(1000);
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
  // Assumes one agent → one entity: if multiple entities share a
  // `linked_agent_id`, the last row processed wins and events would be
  // misattributed to that entity.
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
  // `draymond_events` has no latency column (migration 004 lines 84-100 only
  // carry metadata jsonb), so avg_latency_ms is always 0 here and the entity
  // latency weight in weakness-scoring.ts (0.2) is currently inert. It becomes
  // live once a real latency source exists.
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
  const limit = Math.max(1, opts.queueLimit ?? 5);
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

  // Compute trends from existing history (one query per metric, in parallel).
  const trendHistory: Record<string, number[]> = {};
  await Promise.all(
    metrics.map(async (m) => {
      trendHistory[m.component_slug] = await getTrend(componentClass, m.component_slug);
    })
  );

  const scored = buildWeaknessScores(componentClass, metrics, trendHistory);
  const ranked = [...scored].sort(
    (a, b) => b.score - a.score || a.component_slug.localeCompare(b.component_slug)
  );
  const scoresMap: Record<string, number> = {};
  for (const s of scored) scoresMap[s.component_slug] = s.score;

  const { recorded } = await recordRun(componentClass, metrics, scoresMap);

  const weakest = ranked.slice(0, limit);

  // Deep-score only if requested (Thursday run passes deepScoreLimit > 0).
  let deepScored = 0;
  const deep: Record<string, Record<string, DeepScoreResult>> = {};
  if (opts.deepScoreLimit && opts.deepScoreLimit > 0) {
    for (const w of weakest.slice(0, opts.deepScoreLimit)) {
      const results = await deepScore(componentClass, w.component_slug, w.component_name);
      deep[w.component_slug] = results;
      // Count successes, not attempts: a component whose scorers all soft-fail
      // (every score null) wasn't really deep-scored.
      const scoredAny = Object.values(results).some((r) => r.score != null);
      if (scoredAny) deepScored++;
    }
  }

  const { queued } = await queueWeakest(weakest, limit, deep);

  return {
    componentClass,
    measured: metrics.length,
    recorded,
    weakest: weakest.map((w) => ({ slug: w.component_slug, score: w.score })),
    queued,
    deepScored,
  };
}
