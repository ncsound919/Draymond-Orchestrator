// ============================================================================
// DRAYMOND UPGRADE QUEUE — persist weakest components with proposed actions
// ============================================================================
// Review-first: nothing is auto-repaired. Each queued item carries its reasons
// and a proposed_action so a human or the repair team can act on it.
// ============================================================================

import { createDraymondAdminClient } from './client';
import type { ComponentClass, DeepScoreResult, UpgradeQueueItem, WeaknessScore } from './types';

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
  const weakest = [...ranked].sort((a, b) => b.score - a.score).slice(0, limit);
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
