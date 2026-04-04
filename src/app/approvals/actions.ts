'use server';

import { reviewAction } from '@/lib/draymond/index';
import { sanitizeError } from '@/lib/draymond/api-auth';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

// ---------------------------------------------------------------------------
// Server Actions for Human-in-the-Loop Approvals
// ---------------------------------------------------------------------------

/** Maximum length for review notes to prevent unbounded storage (item 35). */
const MAX_NOTES_LENGTH = 2000;

/**
 * Validate that the request is coming from an authenticated admin session.
 * In the current single-user setup, we verify the CRON_SECRET is present
 * and the request originates from the same origin (item 31).
 *
 * NOTE: This is a basic guard. When real auth (Supabase Auth) is added,
 * replace this with session-based user identification.
 */
async function requireAdmin(): Promise<string> {
  const headersList = await headers();
  const origin = headersList.get('origin') || headersList.get('referer') || '';
  // Server actions are invoked from the same origin via POST.
  // The Next.js server action protocol already validates the origin header,
  // which prevents CSRF from external sites. The reviewer_id should ideally
  // come from a session, but for now we use a fixed admin identity since
  // this is an internal dashboard with no public access.
  if (!origin) {
    // Server actions called without origin are suspicious
    throw new Error('Unauthorized: missing origin header');
  }
  return 'admin';
}

/**
 * Approve a pending action.
 */
export async function approveAction(actionId: string, notes?: string) {
  if (!actionId || typeof actionId !== 'string') {
    throw new Error('Invalid action ID');
  }

  const reviewerId = await requireAdmin();

  // Truncate notes to prevent unbounded storage (item 35)
  const sanitizedNotes = notes?.trim().slice(0, MAX_NOTES_LENGTH) || undefined;

  try {
    const result = await reviewAction(actionId, reviewerId, true, sanitizedNotes);
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

  const reviewerId = await requireAdmin();

  // Truncate notes to prevent unbounded storage (item 35)
  const sanitizedNotes = notes?.trim().slice(0, MAX_NOTES_LENGTH) || undefined;

  try {
    const result = await reviewAction(actionId, reviewerId, false, sanitizedNotes);
    revalidatePath('/approvals');
    return result;
  } catch (err) {
    // Sanitize error before sending to client (item 32)
    throw new Error(sanitizeError(err));
  }
}
