// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Adaptive Confidence Scoring
// ============================================================================
// Replaces the hardcoded DEFAULT_ENTITY_CONFIDENCE_SCORE = 0.85 with real
// confidence scores derived from multiple signals:
//
// 1. Historical success rate — what % of past invocations succeeded
// 2. Entity health — current health status and consecutive errors
// 3. Recent execution trend — are recent runs succeeding or failing
// 4. Chain context — does the step's position in the chain affect risk
// 5. LLM assessment — optional LLM-based confidence for complex cases
//
// The system self-tunes: thresholds adapt based on actual outcomes.
// ============================================================================

import { createDraymondClient } from './client';
import { logEvent } from './index';
import type {
  ConfidenceSignal,
  AdaptiveConfidenceResult,
  EntityPerformanceRecord,
  DraymondEntity,
  ExecutionLogInsert,
} from './types';

// ── Constants ────────────────────────────────────────────────────────────────

/** Fallback score when we have zero history for an entity. */
const BASELINE_CONFIDENCE = 0.75;

/** Number of recent executions to consider for trend analysis. */
const RECENT_WINDOW = 20;

/** Minimum executions needed before historical rate is trusted. */
const MIN_EXECUTIONS_FOR_HISTORY = 5;

/** Signal weights — sum should be ~1.0 for the core signals. */
const SIGNAL_WEIGHTS = {
  historical_rate: 0.40,
  entity_health: 0.20,
  recent_trend: 0.25,
  chain_context: 0.15,
} as const;

// ── Execution logging ────────────────────────────────────────────────────────

/**
 * Log an entity execution result. This feeds the adaptive confidence system.
 * Call this after every entity invocation (success or failure).
 */
export async function logExecution(input: ExecutionLogInsert): Promise<void> {
  const supabase = await createDraymondClient();

  const { error } = await supabase.from('draymond_execution_logs').insert({
    entity_id: input.entity_id,
    entity_slug: input.entity_slug,
    chain_id: input.chain_id,
    step_id: input.step_id,
    action: input.action,
    success: input.success,
    duration_ms: input.duration_ms,
    input_summary: input.input_summary ?? '',
    output_summary: input.output_summary ?? '',
    error_message: input.error_message,
    cost_cents: input.cost_cents ?? 0,
    created_at: new Date().toISOString(),
  });

  if (error) {
    // Non-fatal — don't crash the invocation pipeline
    console.error(`[Draymond/Confidence] Failed to log execution: ${error.message}`);
  }
}

// ── Performance record computation ───────────────────────────────────────────

/**
 * Compute performance metrics for an entity from its execution history.
 */
export async function getEntityPerformance(
  entityId: string,
  entitySlug: string
): Promise<EntityPerformanceRecord> {
  const supabase = await createDraymondClient();

  const { data: logs, error } = await supabase
    .from('draymond_execution_logs')
    .select('success, duration_ms, created_at')
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error(`[Draymond/Confidence] Failed to fetch execution logs: ${error.message}`);
  }

  const allLogs = (logs || []) as Array<{
    success: boolean;
    duration_ms: number;
    created_at: string;
  }>;

  const total = allLogs.length;
  const successful = allLogs.filter((l) => l.success).length;
  const failed = total - successful;

  // Duration percentiles
  const durations = allLogs.map((l) => l.duration_ms).sort((a, b) => a - b);
  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  const p99 = percentile(durations, 0.99);
  const avg = total > 0 ? durations.reduce((s, d) => s + d, 0) / total : 0;

  // Current streak
  let streak = 0;
  let streakType: 'success' | 'failure' = allLogs[0]?.success ? 'success' : 'failure';
  for (const log of allLogs) {
    if (log.success === (streakType === 'success')) {
      streak++;
    } else {
      break;
    }
  }

  // Last success/failure timestamps
  const lastSuccess = allLogs.find((l) => l.success)?.created_at ?? null;
  const lastFailure = allLogs.find((l) => !l.success)?.created_at ?? null;

  return {
    entity_id: entityId,
    entity_slug: entitySlug,
    total_executions: total,
    successful_executions: successful,
    failed_executions: failed,
    avg_duration_ms: Math.round(avg),
    p50_duration_ms: Math.round(p50),
    p95_duration_ms: Math.round(p95),
    p99_duration_ms: Math.round(p99),
    success_rate: total > 0 ? successful / total : 0,
    last_success_at: lastSuccess,
    last_failure_at: lastFailure,
    current_streak: streak,
    streak_type: streakType,
    computed_at: new Date().toISOString(),
  };
}

// ── Adaptive confidence computation ──────────────────────────────────────────

/**
 * Compute an adaptive confidence score for an entity.
 * Uses multiple signals weighted together to produce a score between 0 and 1.
 *
 * This replaces the hardcoded `DEFAULT_ENTITY_CONFIDENCE_SCORE = 0.85`.
 */
export async function computeConfidence(
  entityId: string,
  entitySlug: string,
  chainContext?: {
    step_index: number;
    total_steps: number;
    previous_step_succeeded: boolean;
    chain_failure_count: number;
  }
): Promise<AdaptiveConfidenceResult> {
  const signals: ConfidenceSignal[] = [];

  // 1. Historical success rate
  const perf = await getEntityPerformance(entityId, entitySlug);

  if (perf.total_executions >= MIN_EXECUTIONS_FOR_HISTORY) {
    signals.push({
      source: 'historical_rate',
      weight: SIGNAL_WEIGHTS.historical_rate,
      score: perf.success_rate,
      reasoning: `${perf.successful_executions}/${perf.total_executions} executions succeeded (${(perf.success_rate * 100).toFixed(1)}%)`,
    });
  } else {
    signals.push({
      source: 'historical_rate',
      weight: SIGNAL_WEIGHTS.historical_rate,
      score: BASELINE_CONFIDENCE,
      reasoning: `Only ${perf.total_executions} executions — using baseline ${BASELINE_CONFIDENCE}`,
    });
  }

  // 2. Entity health status
  const healthSignal = await computeHealthSignal(entityId);
  signals.push(healthSignal);

  // 3. Recent execution trend
  const trendSignal = computeTrendSignal(perf);
  signals.push(trendSignal);

  // 4. Chain context (if executing within a chain)
  if (chainContext) {
    const contextSignal = computeChainContextSignal(chainContext);
    signals.push(contextSignal);
  } else {
    signals.push({
      source: 'chain_context',
      weight: SIGNAL_WEIGHTS.chain_context,
      score: BASELINE_CONFIDENCE,
      reasoning: 'Not executing within a chain — using baseline',
    });
  }

  // Compute weighted final score
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const weightedSum = signals.reduce((sum, s) => sum + s.score * s.weight, 0);
  const finalScore = totalWeight > 0 ? weightedSum / totalWeight : BASELINE_CONFIDENCE;

  // Clamp to [0, 1]
  const clampedScore = Math.max(0, Math.min(1, finalScore));

  // Compute recommended threshold based on entity's risk profile
  const thresholdRec = computeThresholdRecommendation(perf);

  const result: AdaptiveConfidenceResult = {
    final_score: Number(clampedScore.toFixed(4)),
    signals,
    entity_id: entityId,
    entity_slug: entitySlug,
    historical_success_rate:
      perf.total_executions >= MIN_EXECUTIONS_FOR_HISTORY ? perf.success_rate : null,
    recent_executions: perf.total_executions,
    threshold_recommendation: thresholdRec,
    computed_at: new Date().toISOString(),
  };

  return result;
}

// ── Signal computations ──────────────────────────────────────────────────────

async function computeHealthSignal(entityId: string): Promise<ConfidenceSignal> {
  const supabase = await createDraymondClient();

  // Try linked agent first
  const { data: entity } = await supabase
    .from('draymond_entities')
    .select('health_status, linked_agent_id')
    .eq('id', entityId)
    .single();

  if (!entity) {
    return {
      source: 'entity_health',
      weight: SIGNAL_WEIGHTS.entity_health,
      score: BASELINE_CONFIDENCE,
      reasoning: 'Entity not found — using baseline',
    };
  }

  const typedEntity = entity as { health_status: string; linked_agent_id: string | null };

  // Map health status to score
  const healthScores: Record<string, number> = {
    healthy: 1.0,
    online: 1.0,
    degraded: 0.6,
    stalled: 0.3,
    crashed: 0.1,
    offline: 0.1,
    unknown: 0.5,
  };

  const healthScore = healthScores[typedEntity.health_status] ?? 0.5;

  // If there's a linked agent, also check its status
  if (typedEntity.linked_agent_id) {
    const { data: agent } = await supabase
      .from('draymond_agents')
      .select('status, consecutive_errors, max_consecutive_errors')
      .eq('id', typedEntity.linked_agent_id)
      .single();

    if (agent) {
      const typedAgent = agent as {
        status: string;
        consecutive_errors: number;
        max_consecutive_errors: number;
      };
      const agentHealthScores: Record<string, number> = {
        active: 1.0,
        degraded: 0.6,
        recovering: 0.4,
        stalled: 0.2,
        crashed: 0.1,
        suspended: 0.1,
        terminated: 0.0,
      };
      const agentScore = agentHealthScores[typedAgent.status] ?? 0.5;

      // Blend entity health and agent health (agent weighs more)
      const blended = healthScore * 0.3 + agentScore * 0.7;
      const errorPenalty =
        typedAgent.consecutive_errors > 0
          ? Math.min(0.3, typedAgent.consecutive_errors * 0.1)
          : 0;

      return {
        source: 'entity_health',
        weight: SIGNAL_WEIGHTS.entity_health,
        score: Math.max(0, blended - errorPenalty),
        reasoning:
          `Entity health: ${typedEntity.health_status} (${healthScore}), ` +
          `Agent status: ${typedAgent.status} (${agentScore}), ` +
          `Consecutive errors: ${typedAgent.consecutive_errors}`,
      };
    }
  }

  return {
    source: 'entity_health',
    weight: SIGNAL_WEIGHTS.entity_health,
    score: healthScore,
    reasoning: `Entity health status: ${typedEntity.health_status}`,
  };
}

function computeTrendSignal(perf: EntityPerformanceRecord): ConfidenceSignal {
  if (perf.total_executions < 3) {
    return {
      source: 'recent_trend',
      weight: SIGNAL_WEIGHTS.recent_trend,
      score: BASELINE_CONFIDENCE,
      reasoning: 'Too few executions for trend analysis',
    };
  }

  // Streak-based scoring
  let trendScore: number;
  let reasoning: string;

  if (perf.streak_type === 'success') {
    // Success streak — boost confidence
    trendScore = Math.min(1.0, 0.7 + perf.current_streak * 0.05);
    reasoning = `Success streak of ${perf.current_streak} — trending positive`;
  } else {
    // Failure streak — reduce confidence
    trendScore = Math.max(0.1, 0.7 - perf.current_streak * 0.15);
    reasoning = `Failure streak of ${perf.current_streak} — trending negative`;
  }

  return {
    source: 'recent_trend',
    weight: SIGNAL_WEIGHTS.recent_trend,
    score: trendScore,
    reasoning,
  };
}

function computeChainContextSignal(ctx: {
  step_index: number;
  total_steps: number;
  previous_step_succeeded: boolean;
  chain_failure_count: number;
}): ConfidenceSignal {
  let score = 0.8;
  const reasons: string[] = [];

  // Later steps in a chain have more accumulated context — slightly higher confidence
  if (ctx.step_index > 0 && ctx.previous_step_succeeded) {
    score += 0.05;
    reasons.push('Previous step succeeded');
  }

  // If previous step failed, lower confidence for next step
  if (ctx.step_index > 0 && !ctx.previous_step_succeeded) {
    score -= 0.15;
    reasons.push('Previous step failed — cascade risk');
  }

  // Chain with multiple failures — progressive confidence reduction
  if (ctx.chain_failure_count > 0) {
    score -= Math.min(0.3, ctx.chain_failure_count * 0.1);
    reasons.push(`${ctx.chain_failure_count} step(s) already failed in this chain`);
  }

  return {
    source: 'chain_context',
    weight: SIGNAL_WEIGHTS.chain_context,
    score: Math.max(0, Math.min(1, score)),
    reasoning: reasons.length > 0 ? reasons.join('; ') : 'Normal chain context',
  };
}

// ── Self-tuning threshold ────────────────────────────────────────────────────

/**
 * Recommend a confidence threshold for an entity based on its track record.
 *
 * Entities with high success rates get lower thresholds (we trust them more).
 * Entities with low success rates get higher thresholds (require more confidence).
 */
function computeThresholdRecommendation(perf: EntityPerformanceRecord): number {
  if (perf.total_executions < MIN_EXECUTIONS_FOR_HISTORY) {
    return 0.8; // Conservative for unknown entities
  }

  // Inverse relationship: high success rate → lower threshold needed
  // success_rate 1.0 → threshold 0.6
  // success_rate 0.5 → threshold 0.85
  // success_rate 0.0 → threshold 0.95
  const threshold = 0.95 - perf.success_rate * 0.35;
  return Number(Math.max(0.5, Math.min(0.95, threshold)).toFixed(3));
}

// ── Utility ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Batch performance report ─────────────────────────────────────────────────

/**
 * Get performance records for all active entities.
 * Useful for the dashboard leaderboard.
 */
export async function getAllEntityPerformance(): Promise<EntityPerformanceRecord[]> {
  const supabase = await createDraymondClient();

  const { data: entities } = await supabase
    .from('draymond_entities')
    .select('id, slug')
    .eq('is_active', true);

  if (!entities || entities.length === 0) return [];

  const records = await Promise.all(
    (entities as Array<{ id: string; slug: string }>).map((e) =>
      getEntityPerformance(e.id, e.slug)
    )
  );

  return records.sort((a, b) => b.success_rate - a.success_rate);
}
