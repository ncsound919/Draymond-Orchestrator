'use server';

import { reviewAction } from '@/lib/draymond/index';
import { sanitizeError } from '@/lib/draymond/api-auth';
import { requireDraymondActionAuth } from '@/lib/draymond/auth';
import { revalidatePath } from 'next/cache';

// ---------------------------------------------------------------------------
// Server Actions for Human-in-the-Loop Approvals
// ---------------------------------------------------------------------------

/** Maximum length for review notes to prevent unbounded storage (item 35). */
const MAX_NOTES_LENGTH = 2000;

/**
 * Approve a pending action.
 */
export async function approveAction(actionId: string, notes?: string) {
  if (!actionId || typeof actionId !== 'string') {
    throw new Error('Invalid action ID');
  }

  const reviewer = await requireDraymondActionAuth();

  // Truncate notes to prevent unbounded storage (item 35)
  const sanitizedNotes = notes?.trim().slice(0, MAX_NOTES_LENGTH) || undefined;

  try {
    const result = await reviewAction(actionId, reviewer.id, true, sanitizedNotes);
    revalidatePath('/approvals');
    return result;
  } catch (err) {
    // Sanitize error before sending to client (item 32)
    throw new Error(sanitizeError(err));
  }
}

/**
 * Reject a pending action.
 */
export async function rejectAction(actionId: string, notes?: string) {
  if (!actionId || typeof actionId !== 'string') {
    throw new Error('Invalid action ID');
  }

  const reviewer = await requireDraymondActionAuth();

  // Truncate notes to prevent unbounded storage (item 35)
  const sanitizedNotes = notes?.trim().slice(0, MAX_NOTES_LENGTH) || undefined;

  try {
    const result = await reviewAction(actionId, reviewer.id, false, sanitizedNotes);
    revalidatePath('/approvals');
    return result;
  } catch (err) {
    // Sanitize error before sending to client (item 32)
    throw new Error(sanitizeError(err));
  }
}
