// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Observability & Analytics
// ============================================================================
// Performance leaderboard, execution heatmaps, cost tracking,
// and latency percentiles for the entire orchestration system.
//
// Data sources:
// - draymond_execution_logs (populated by confidence.ts logExecution)
// - draymond_cost_records (populated by this module's trackCost)
// - draymond_entities, draymond_chains
// ============================================================================

import { createDraymondClient } from './client';
import type {
  EntityLeaderboardEntry,
  ExecutionHeatmapPoint,
  CostRecord,
  CostRecordInsert,
  AnalyticsSummary,
  ExecutionLog,
  EntityKind,
} from './types';

// ── Cost Tracking ────────────────────────────────────────────────────────────

/**
 * Record a cost associated with an entity execution.
 */
export async function trackCost(input: CostRecordInsert): Promise<void> {
  const supabase = await createDraymondClient();

  const { error } = await supabase.from('draymond_cost_records').insert({
    entity_id: input.entity_id,
    chain_id: input.chain_id,
    step_id: input.step_id,
    cost_type: input.cost_type,
    amount_cents: input.amount_cents,
    unit_count: input.unit_count ?? 1,
    unit_label: input.unit_label ?? 'unit',
    metadata: input.metadata ?? {},
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error(`[Draymond/Analytics] Failed to track cost: ${error.message}`);
  }
}

/**
 * Get total cost for a time period.
 */
export async function getCostSummary(
  since: string,
  entityId?: string
): Promise<{
  total_cents: number;
  by_type: Record<string, number>;
  by_entity: Record<string, number>;
}> {
  const supabase = await createDraymondClient();

  let query = supabase
    .from('draymond_cost_records')
    .select('entity_id, cost_type, amount_cents')
    .gte('created_at', since);

  if (entityId) {
    query = query.eq('entity_id', entityId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch cost records: ${error.message}`);

  const records = (data || []) as Array<{
    entity_id: string;
    cost_type: string;
    amount_cents: number;
  }>;

  const byType: Record<string, number> = {};
  const byEntity: Record<string, number> = {};
  let total = 0;

  for (const r of records) {
    total += r.amount_cents;
    byType[r.cost_type] = (byType[r.cost_type] || 0) + r.amount_cents;
    byEntity[r.entity_id] = (byEntity[r.entity_id] || 0) + r.amount_cents;
  }

  return { total_cents: total, by_type: byType, by_entity: byEntity };
}

// ── Performance Leaderboard ──────────────────────────────────────────────────

/**
 * Generate a leaderboard ranking entities by a composite score.
 * Score = success_rate * 0.5 + speed_score * 0.3 + cost_efficiency * 0.2
 */
export async function getEntityLeaderboard(
  since: string,
  limit: number = 20
): Promise<EntityLeaderboardEntry[]> {
  const supabase = await createDraymondClient();

  // Fetch execution logs for the period
  const { data: logs } = await supabase
    .from('draymond_execution_logs')
    .select('entity_id, entity_slug, success, duration_ms, cost_cents')
    .gte('created_at', since);

  if (!logs || logs.length === 0) return [];

  const typedLogs = logs as Array<{
    entity_id: string;
    entity_slug: string;
    success: boolean;
    duration_ms: number;
    cost_cents: number;
  }>;

  // Get entity details
  const entityIds = [...new Set(typedLogs.map((l) => l.entity_id))];
  const { data: entities } = await supabase
    .from('draymond_entities')
    .select('id, slug, name, kind')
    .in('id', entityIds);

  const entityMap = new Map(
    ((entities || []) as Array<{ id: string; slug: string; name: string; kind: EntityKind }>).map(
      (e) => [e.id, e]
    )
  );

  // Aggregate stats per entity
  const statsMap = new Map<
    string,
    {
      entity_id: string;
      entity_slug: string;
      total: number;
      successes: number;
      durations: number[];
      total_cost: number;
    }
  >();

  for (const log of typedLogs) {
    let stats = statsMap.get(log.entity_id);
    if (!stats) {
      stats = {
        entity_id: log.entity_id,
        entity_slug: log.entity_slug,
        total: 0,
        successes: 0,
        durations: [],
        total_cost: 0,
      };
      statsMap.set(log.entity_id, stats);
    }
    stats.total++;
    if (log.success) stats.successes++;
    stats.durations.push(log.duration_ms);
    stats.total_cost += log.cost_cents || 0;
  }

  // Compute max duration for normalization
  const allDurations = typedLogs.map((l) => l.duration_ms);
  const maxDuration = Math.max(...allDurations, 1);
  const maxCost = Math.max(
    ...Array.from(statsMap.values()).map((s) => s.total_cost),
    1
  );

  // Build leaderboard entries
  const entries: EntityLeaderboardEntry[] = [];

  for (const stats of statsMap.values()) {
    const entity = entityMap.get(stats.entity_id);
    const successRate = stats.total > 0 ? stats.successes / stats.total : 0;
    const sortedDurations = [...stats.durations].sort((a, b) => a - b);
    const avgDuration =
      sortedDurations.reduce((s, d) => s + d, 0) / sortedDurations.length;
    const p95Duration = percentile(sortedDurations, 0.95);

    // Speed score: inverse of normalized duration (faster = higher)
    const speedScore = 1 - Math.min(1, avgDuration / maxDuration);

    // Cost efficiency: inverse of normalized cost (cheaper = higher)
    const costEfficiency = 1 - Math.min(1, stats.total_cost / maxCost);

    // Composite score
    const score = successRate * 0.5 + speedScore * 0.3 + costEfficiency * 0.2;

    entries.push({
      entity_id: stats.entity_id,
      entity_slug: stats.entity_slug,
      entity_name: entity?.name ?? stats.entity_slug,
      entity_kind: entity?.kind ?? 'agent',
      total_executions: stats.total,
      success_rate: Number(successRate.toFixed(4)),
      avg_duration_ms: Math.round(avgDuration),
      p95_duration_ms: Math.round(p95Duration),
      total_cost_cents: stats.total_cost,
      score: Number(score.toFixed(4)),
      rank: 0, // Set after sorting
    });
  }

  // Sort by score descending and assign ranks
  entries.sort((a, b) => b.score - a.score);
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  return entries.slice(0, limit);
}

// ── Execution Heatmap ────────────────────────────────────────────────────────

/**
 * Generate an execution heatmap showing activity patterns by hour and day of week.
 */
export async function getExecutionHeatmap(
  since: string,
  entityId?: string
): Promise<ExecutionHeatmapPoint[]> {
  const supabase = await createDraymondClient();

  let query = supabase
    .from('draymond_execution_logs')
    .select('success, duration_ms, created_at')
    .gte('created_at', since);

  if (entityId) {
    query = query.eq('entity_id', entityId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch heatmap data: ${error.message}`);

  const logs = (data || []) as Array<{
    success: boolean;
    duration_ms: number;
    created_at: string;
  }>;

  // Aggregate by hour × day_of_week
  const grid = new Map<
    string,
    {
      count: number;
      totalDuration: number;
      failures: number;
    }
  >();

  for (const log of logs) {
    const dt = new Date(log.created_at);
    const hour = dt.getUTCHours();
    const day = dt.getUTCDay();
    const key = `${day}-${hour}`;

    let cell = grid.get(key);
    if (!cell) {
      cell = { count: 0, totalDuration: 0, failures: 0 };
      grid.set(key, cell);
    }

    cell.count++;
    cell.totalDuration += log.duration_ms;
    if (!log.success) cell.failures++;
  }

  // Build full 7×24 grid (fill missing cells with zeros)
  const points: ExecutionHeatmapPoint[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const cell = grid.get(`${day}-${hour}`);
      points.push({
        hour,
        day_of_week: day,
        execution_count: cell?.count ?? 0,
        avg_duration_ms: cell && cell.count > 0
          ? Math.round(cell.totalDuration / cell.count)
          : 0,
        failure_rate: cell && cell.count > 0
          ? Number((cell.failures / cell.count).toFixed(4))
          : 0,
      });
    }
  }

  return points;
}

// ── Latency Percentiles ──────────────────────────────────────────────────────

/**
 * Compute latency percentiles (P50, P95, P99) for an entity or globally.
 */
export async function getLatencyPercentiles(
  since: string,
  entityId?: string
): Promise<{
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  avg_ms: number;
  min_ms: number;
  max_ms: number;
  sample_count: number;
}> {
  const supabase = await createDraymondClient();

  let query = supabase
    .from('draymond_execution_logs')
    .select('duration_ms')
    .gte('created_at', since);

  if (entityId) {
    query = query.eq('entity_id', entityId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch latency data: ${error.message}`);

  const durations = ((data || []) as Array<{ duration_ms: number }>)
    .map((d) => d.duration_ms)
    .sort((a, b) => a - b);

  if (durations.length === 0) {
    return { p50_ms: 0, p95_ms: 0, p99_ms: 0, avg_ms: 0, min_ms: 0, max_ms: 0, sample_count: 0 };
  }

  const avg = durations.reduce((s, d) => s + d, 0) / durations.length;

  return {
    p50_ms: Math.round(percentile(durations, 0.50)),
    p95_ms: Math.round(percentile(durations, 0.95)),
    p99_ms: Math.round(percentile(durations, 0.99)),
    avg_ms: Math.round(avg),
    min_ms: durations[0],
    max_ms: durations[durations.length - 1],
    sample_count: durations.length,
  };
}

// ── Full Analytics Summary ───────────────────────────────────────────────────

/**
 * Generate a comprehensive analytics summary for a time period.
 */
export async function getAnalyticsSummary(
  period: 'hour' | 'day' | 'week' | 'month' = 'day'
): Promise<AnalyticsSummary> {
  const now = new Date();
  const periodMs: Record<string, number> = {
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };

  const since = new Date(now.getTime() - periodMs[period]).toISOString();

  // Run queries in parallel
  const [latency, leaderboard, heatmap, costSummary, chainCount] = await Promise.all([
    getLatencyPercentiles(since),
    getEntityLeaderboard(since, 10),
    getExecutionHeatmap(since),
    getCostSummary(since),
    getChainRunCount(since),
  ]);

  // Compute totals from leaderboard
  const totalExecutions = leaderboard.reduce((s, e) => s + e.total_executions, 0);
  const successfulExecutions = leaderboard.reduce(
    (s, e) => s + Math.round(e.total_executions * e.success_rate),
    0
  );

  // Find busiest hour
  const busiestHour = heatmap.reduce(
    (best, point) => (point.execution_count > best.execution_count ? point : best),
    { hour: 0, execution_count: 0 } as { hour: number; execution_count: number }
  );

  return {
    period,
    total_executions: totalExecutions,
    successful_executions: successfulExecutions,
    failed_executions: totalExecutions - successfulExecutions,
    total_chains_run: chainCount,
    total_cost_cents: costSummary.total_cents,
    avg_latency_ms: latency.avg_ms,
    p50_latency_ms: latency.p50_ms,
    p95_latency_ms: latency.p95_ms,
    p99_latency_ms: latency.p99_ms,
    busiest_hour: busiestHour.hour,
    top_entities: leaderboard,
    heatmap,
    computed_at: new Date().toISOString(),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getChainRunCount(since: string): Promise<number> {
  const supabase = await createDraymondClient();

  const { count, error } = await supabase
    .from('draymond_chains')
    .select('*', { count: 'exact', head: true })
    .eq('is_template', false)
    .gte('created_at', since);

  if (error) return 0;
  return count ?? 0;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Recent Execution Log Query ───────────────────────────────────────────────

/**
 * Get recent execution logs with optional filtering.
 */
export async function getRecentExecutions(options: {
  entity_id?: string;
  chain_id?: string;
  success?: boolean;
  since?: string;
  limit?: number;
} = {}): Promise<ExecutionLog[]> {
  const supabase = await createDraymondClient();
  const limit = Math.min(options.limit ?? 50, 200);

  let query = supabase
    .from('draymond_execution_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (options.entity_id) query = query.eq('entity_id', options.entity_id);
  if (options.chain_id) query = query.eq('chain_id', options.chain_id);
  if (options.success !== undefined) query = query.eq('success', options.success);
  if (options.since) query = query.gte('created_at', options.since);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch execution logs: ${error.message}`);
  return (data || []) as ExecutionLog[];
}
