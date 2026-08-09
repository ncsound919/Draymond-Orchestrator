'use server';

import { instantiateChain, executeChain, deleteChain, updateChain } from '@/lib/draymond/chains';
import { requireDraymondActionAuth } from '@/lib/draymond/auth';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

/**
 * Server action — instantiate a chain template and execute it.
 * Returns actual execution status instead of hardcoded value.
 */
export async function runWorkflow(chainId: string) {
  await requireDraymondActionAuth();

  if (!chainId || typeof chainId !== 'string') {
    throw new Error('Invalid chain ID');
  }

  const instance = await instantiateChain(chainId, {});
  const result = await executeChain(instance.id);

  const stepEntries = result.steps ? Object.values(result.steps) : [];
  const failedCount = stepEntries.filter((s) => s.status === 'failed').length;
  const derivedStatus = stepEntries.length === 0
    ? 'unknown'
    : failedCount > 0
      ? 'failed'
      : 'completed';

  revalidatePath(`/workflows/${chainId}`);
  return {
    chain_id: instance.id,
    status: derivedStatus,
    steps: stepEntries.length,
  };
}

const VALID_CHAIN_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
const VALID_TRIGGERS = ['manual', 'scheduled', 'api', 'webhook'] as const;

/** Server action — update a workflow template's metadata / status / trigger. */
export async function updateWorkflow(
  chainId: string,
  updates: {
    name?: string;
    description?: string;
    status?: string;
    trigger_type?: string;
    max_retries?: number;
  }
) {
  await requireDraymondActionAuth();

  if (!chainId || typeof chainId !== 'string') {
    throw new Error('Invalid chain ID');
  }

  const payload: Parameters<typeof updateChain>[1] = {};
  if (updates.name !== undefined) {
    if (typeof updates.name !== 'string' || updates.name.trim().length === 0) {
      throw new Error('Name must be a non-empty string');
    }
    payload.name = updates.name.trim();
  }
  if (updates.description !== undefined) {
    if (typeof updates.description !== 'string') throw new Error('Description must be a string');
    payload.description = updates.description.trim() || null;
  }
  if (updates.status !== undefined) {
    if (!VALID_CHAIN_STATUSES.includes(updates.status as typeof VALID_CHAIN_STATUSES[number])) {
      throw new Error(`Invalid status. Must be one of: ${VALID_CHAIN_STATUSES.join(', ')}`);
    }
    payload.status = updates.status as typeof VALID_CHAIN_STATUSES[number];
  }
  if (updates.trigger_type !== undefined) {
    if (!VALID_TRIGGERS.includes(updates.trigger_type as typeof VALID_TRIGGERS[number])) {
      throw new Error(`Invalid trigger. Must be one of: ${VALID_TRIGGERS.join(', ')}`);
    }
    payload.trigger_type = updates.trigger_type;
  }
  if (updates.max_retries !== undefined) {
    if (typeof updates.max_retries !== 'number' || updates.max_retries < 0) {
      throw new Error('max_retries must be a non-negative number');
    }
    payload.max_retries = updates.max_retries;
  }

  const chain = await updateChain(chainId, payload);
  revalidatePath(`/workflows/${chainId}`);
  revalidatePath('/workflows');
  return chain;
}

/**
 * Server action — delete a chain template.
 */
export async function deleteWorkflowAction(chainId: string) {
  await requireDraymondActionAuth();

  if (!chainId || typeof chainId !== 'string') {
    throw new Error('Invalid chain ID');
  }

  await deleteChain(chainId);

  // redirect() must be called outside try/catch — it throws NEXT_REDIRECT
  redirect('/workflows');
}
