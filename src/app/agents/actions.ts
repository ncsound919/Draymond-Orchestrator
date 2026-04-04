'use server';

import { getEntity, recordInvocation } from '@/lib/draymond/registry';
import { invokeEntity } from '@/lib/draymond/invoker';
import type { EntityForInvocation } from '@/lib/draymond/invoker';
import { initiateRecovery } from '@/lib/draymond/index';

/**
 * Server action — invoke an entity from the QuickActions panel.
 * Runs server-side so CRON_SECRET is never exposed to the browser.
 */
export async function invokeAgent(entityId: string): Promise<{ ok: boolean; message: string }> {
  if (!entityId || typeof entityId !== 'string') {
    return { ok: false, message: 'Invalid entity ID' };
  }

  try {
    const entity = await getEntity(entityId);
    if (!entity) {
      return { ok: false, message: `Entity "${entityId}" not found` };
    }

    const entityMinimal: EntityForInvocation = {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      kind: entity.kind,
      invocation_method: entity.invocation_method,
      invocation_config: (entity.invocation_config as Record<string, unknown>) ?? {},
      timeout_seconds: entity.timeout_seconds,
    };

    await invokeEntity(entityMinimal, 'invoke', {}, {});

    // Record invocation (non-fatal)
    try {
      await recordInvocation(entity.id);
    } catch (recordErr) {
      console.error(
        '[invokeAgent] Failed to record invocation:',
        recordErr instanceof Error ? recordErr.message : recordErr,
      );
    }

    return { ok: true, message: 'Invoked successfully' };
  } catch (err) {
    console.error('[invokeAgent]', err instanceof Error ? err.message : err);
    return { ok: false, message: 'Invocation failed' };
  }
}

/**
 * Server action — trigger recovery for an entity from the QuickActions panel.
 */
export async function recoverAgent(entityId: string): Promise<{ ok: boolean; message: string }> {
  if (!entityId || typeof entityId !== 'string') {
    return { ok: false, message: 'Invalid entity ID' };
  }

  try {
    await initiateRecovery(entityId);
    return { ok: true, message: 'Recovery initiated' };
  } catch (err) {
    console.error('[recoverAgent]', err instanceof Error ? err.message : err);
    return { ok: false, message: 'Recovery failed' };
  }
}
