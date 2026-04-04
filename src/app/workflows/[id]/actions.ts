'use server';

import { instantiateChain, executeChain, deleteChain } from '@/lib/draymond/chains';
import { redirect } from 'next/navigation';

/**
 * Server action — instantiate a chain template and execute it.
 * Returns actual execution status instead of hardcoded value.
 */
export async function runWorkflow(chainId: string) {
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

  return {
    chain_id: instance.id,
    status: derivedStatus,
    steps: stepEntries.length,
  };
}

/**
 * Server action — delete a chain template.
 */
export async function deleteWorkflowAction(chainId: string) {
  if (!chainId || typeof chainId !== 'string') {
    throw new Error('Invalid chain ID');
  }

  await deleteChain(chainId);

  // redirect() must be called outside try/catch — it throws NEXT_REDIRECT
  redirect('/workflows');
}
