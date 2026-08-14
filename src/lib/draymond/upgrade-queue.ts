// ============================================================================
// DRAYMOND UPGRADE QUEUE — persist weakest components with proposed actions
// ============================================================================
// Review-first: nothing is auto-repaired. Each queued item carries its reasons
// and a proposed_action so a human or the repair team can act on it.
// ============================================================================

import { createDraymondAdminClient } from './client';
import type { ComponentClass, DeepScoreResult, UpgradeQueueItem, WeaknessScore } from './types';

// ============================================================================
// FAILOVER MATRIX — weakness score → machine-readable remediation
// ============================================================================
// Industry pattern (OpenClaw failover engine): convert a weakness score into a
// concrete, auto-appliable action instead of a bare number. Bands:
//   ≥80  → bump model tier / rotate API profile (highest urgency)
//   50–79 → reconfigure invocation (model, endpoint, retries) + repair pass
//   <50  → monitor only
// The matrix is recommendation-first (fail closed): `reconfigureEntity` only
// applies changes when DRAYMOND_FAILOVER_MATRIX=1.
// ============================================================================

export type FailoverAction =
  | { type: 'bump_model_tier'; urgency: 'high'; action: string; change?: Record<string, unknown> }
  | { type: 'reconfigure'; urgency: 'high' | 'medium'; action: string; change?: Record<string, unknown> }
  | { type: 'monitor'; urgency: 'low'; action: string };

export function failoverActionFor(
  score: number,
  componentClass: ComponentClass,
  reasons: string[]
): FailoverAction {
  if (componentClass === 'entity') {
    if (score >= 80) {
      return {
        type: 'bump_model_tier',
        urgency: 'high',
        action: 'Bump model tier / rotate API profile, then re-run the benchmark.',
        change: { max_retries: 5, timeout_seconds: 600 },
      };
    }
    if (score >= 50) {
      return {
        type: 'reconfigure',
        urgency: 'medium',
        action: 'Reconfigure entity invocation (model, endpoint, retries) and run a repair pass.',
        change: { max_retries: 3, timeout_seconds: 450 },
      };
    }
    return { type: 'monitor', urgency: 'low', action: 'Monitor only — score below remediation band.' };
  }
  if (componentClass === 'site' && (score >= 80 || reasons.some((r) => /down|failure|unreachable/i.test(r)))) {
    return {
      type: 'reconfigure',
      urgency: 'high',
      action: 'Restart the service and verify the health endpoint; check deployment logs.',
    };
  }
  if (componentClass === 'cron' || componentClass === 'chain') {
    return {
      type: 'reconfigure',
      urgency: 'medium',
      action: 'Hand off to repair-team for config fix; verify cron expression and job handler.',
    };
  }
  return { type: 'monitor', urgency: 'low', action: 'Monitor — no remediation band matched.' };
}

/** Map weakness reasons to a concrete, human/agent-actionable proposal. */
export function proposeActions(
  componentClass: ComponentClass,
  _slug: string,
  reasons: string[]
): string {
  const joined = reasons.join(' ').toLowerCase();
  if (componentClass === 'site') {
    if (joined.includes('down') || joined.includes('failure')) {
      return 'Restart the service and verify the health endpoint; check deployment logs.';
    }
    return 'Verify site routing / TLS / upstream dependency health.';
  }
  if (componentClass === 'entity') {
    if (joined.includes('crashed') || joined.includes('error')) {
      return 'Re-register entity, reconfigure model/provider, and run a repair-team recovery pass.';
    }
    return 'Reconfigure entity invocation (model, endpoint, retries).';
  }
  if (componentClass === 'cron') {
    return 'Hand off to repair-team for config fix; verify cron expression and job handler.';
  }
  return 'Review chain config: entity slugs, step mappings, timeouts, and retries.';
}

/**
 * Apply a matrix action to a weak ENTITY's registry row. Gated by
 * DRAYMOND_FAILOVER_MATRIX=1 (fail closed — review-first by default). Only
 * touches safe, reversible columns: max_retries, timeout_seconds, and resets
 * health_status so the next benchmark re-scores the entity fresh. Returns the
 * action applied or null when gated/skipped.
 */
export async function reconfigureEntity(
  slug: string,
  score: number,
  reasons: string[]
): Promise<FailoverAction | null> {
  const enabled = process.env.DRAYMOND_FAILOVER_MATRIX === '1' || process.env.DRAYMOND_FAILOVER_MATRIX === 'true';
  if (!enabled) return null;

  const action = failoverActionFor(score, 'entity', reasons);
  if (action.type === 'monitor' || !action.change) return action.type === 'monitor' ? action : null;

  const supabase = createDraymondAdminClient();
  const { data: entity, error: findErr } = await supabase
    .from('draymond_entities')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (findErr || !entity) {
    console.warn(`[upgrade-queue] reconfigure skip ${slug}: ${findErr?.message ?? 'entity not found'}`);
    return null;
  }

  const { error } = await supabase
    .from('draymond_entities')
    .update({ ...action.change, health_status: 'unknown' })
    .eq('id', entity.id);
  if (error) {
    console.warn(`[upgrade-queue] reconfigure failed ${slug}: ${error.message}`);
    return null;
  }
  console.log(`[upgrade-queue] reconfigured ${slug} (weakness ${score.toFixed(2)}): ${action.action}`);
  return action;
}

/**
 * Queue the weakest N ranked components (update-or-insert, keep status queued).
 *
 * Why not `.upsert(...)` with `onConflict`? The queue table (migration 012) has
 * a PARTIAL unique index `uq_upgrade_queue_component` on
 * `(component_class, component_slug) where status = 'queued'`. PostgREST only
 * supports column-list conflict targets (`ON CONFLICT (cols)`); it cannot emit
 * the index predicate `WHERE status = 'queued'` required to match a partial
 * index (postgrest-js#403 / PostgREST#2123 are still open). So instead we do an
 * explicit find-then-write: locate a queued row with the same composite key and
 * update it (keeping `created_at`), otherwise insert a fresh queued row. A
 * completed/dismissed row for the same slug is left alone and a new queued row
 * is created, which is exactly what the partial index permits.
 */
export async function queueWeakest(
  ranked: WeaknessScore[],
  limit: number,
  deepScores?: Record<string, Record<string, DeepScoreResult>>
): Promise<{ queued: number; skipped: number }> {
  const supabase = createDraymondAdminClient();
  // Only queue actual weaknesses: a score of 0 means healthy, and filling the
  // review queue with healthy components would bury the real failures.
  const weakest = [...ranked]
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  let queued = 0;
  for (const item of weakest) {
    const row = {
      component_class: item.component_class,
      component_slug: item.component_slug,
      component_name: item.component_name,
      weakness_score: item.score,
      reasons: item.reasons,
      proposed_action: proposeActions(item.component_class, item.component_slug, item.reasons),
      deep_scores: deepScores?.[item.component_slug] ?? {},
      status: 'queued' as const,
    };

    const { data: existing, error: findError } = await supabase
      .from('draymond_upgrade_queue')
      .select('id')
      .eq('component_class', item.component_class)
      .eq('component_slug', item.component_slug)
      .eq('status', 'queued')
      .maybeSingle();
    if (findError) {
      console.error(`[upgrade-queue] failed to look up ${item.component_slug}: ${findError.message}`);
      continue;
    }

    if (existing) {
      // Only refresh deep_scores when this run actually deep-scored the
      // component. A Mon/Wed/Fri run (deepScoreLimit unset) must not wipe a
      // previous Thursday's deep scores back to {}.
      const updatePayload: Record<string, unknown> = {
        component_name: row.component_name,
        weakness_score: row.weakness_score,
        reasons: row.reasons,
        proposed_action: row.proposed_action,
      };
      if (Object.keys(row.deep_scores).length > 0) updatePayload.deep_scores = row.deep_scores;
      const { error } = await supabase
        .from('draymond_upgrade_queue')
        .update(updatePayload)
        .eq('id', existing.id);
      if (error) {
        console.error(`[upgrade-queue] failed to update ${item.component_slug}: ${error.message}`);
        continue;
      }
    } else {
      const { error } = await supabase.from('draymond_upgrade_queue').insert(row);
      if (error) {
        console.error(`[upgrade-queue] failed to queue ${item.component_slug}: ${error.message}`);
        continue;
      }
    }
    queued++;
  }
  return { queued, skipped: weakest.length - queued };
}

/** Mark a queue item completed or dismissed. */
export async function resolveQueueItem(
  id: string,
  outcome: 'completed' | 'dismissed'
): Promise<void> {
  const supabase = createDraymondAdminClient();
  const { error } = await supabase
    .from('draymond_upgrade_queue')
    .update({ status: outcome, completed_at: outcome === 'completed' ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw new Error(`Failed to resolve queue item: ${error.message}`);
}

/** List current queue (weakest first). */
export async function listUpgradeQueue(status?: UpgradeQueueItem['status']): Promise<UpgradeQueueItem[]> {
  const supabase = createDraymondAdminClient();
  let q = supabase.from('draymond_upgrade_queue').select('*').order('weakness_score', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to list upgrade queue: ${error.message}`);
  return (data ?? []) as UpgradeQueueItem[];
}
