'use server';

import { resolveQueueItem as resolveQueueItemDb } from '@/lib/draymond/upgrade-queue';
import { requireDraymondActionAuth } from '@/lib/draymond/auth';
import { revalidatePath } from 'next/cache';

const OUTCOMES = ['completed', 'dismissed'] as const;

/**
 * Mark a queued upgrade item completed or dismissed.
 * Review-first: this is the human's decision on a proposed action.
 */
export async function resolveQueueItem(id: string, outcome: 'completed' | 'dismissed') {
  await requireDraymondActionAuth();
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid queue item ID');
  }
  if (!OUTCOMES.includes(outcome)) {
    throw new Error(`Invalid outcome: ${outcome}`);
  }
  await resolveQueueItemDb(id, outcome);
  revalidatePath('/benchmarks');
}
