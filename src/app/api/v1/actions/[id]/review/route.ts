/**
 * POST /api/v1/actions/[id]/review
 *
 * Human-in-the-loop review endpoint used by the ntfy push-approval relay.
 * Approves or rejects a `pending_review` action.
 *
 * Auth (either is sufficient):
 *   - Bearer token checked against CRON_SECRET env var (admin / scripts)
 *   - X-Review-Token header matching the action's single-use review token
 *     (set by Open-Chat's ntfy HTTP action). `body.token` is also accepted
 *     as a fallback for manual curl usage.
 *
 * Body (JSON):
 *   { approved: boolean, reviewer_id?: string, notes?: string, token?: string }
 *
 * Errors:
 *   401  missing/invalid credential
 *   404  action not found
 *   409  already reviewed (not pending_review)
 *   410  review token expired
 *
 * The review token is NEVER returned in responses.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, requireValidIds } from '@/lib/draymond/api-auth';
import { reviewAction } from '@/lib/draymond';
import { createDraymondAdminClient } from '@/lib/draymond/client';
import { timingSafeEqual } from 'crypto';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Timing-safe comparison for 64-char hex review tokens. */
function safeTokenCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Strip the review token before returning an action to callers. */
function toPublicAction(action: Record<string, unknown>): Record<string, unknown> {
  const { review_token, review_token_expires_at, ...publicAction } = action;
  void review_token;
  void review_token_expires_at;
  return publicAction;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const idError = requireValidIds({ action_id: id });
  if (idError) return idError;

  const bodyResult = await parseJsonBody<{
    approved?: unknown;
    reviewer_id?: unknown;
    notes?: unknown;
    token?: unknown;
  }>(request);
  if (bodyResult.error) return bodyResult.error;
  const { approved, reviewer_id, notes, token } = bodyResult.data;

  if (typeof approved !== 'boolean') {
    return NextResponse.json(
      { error: 'Missing required field: approved (boolean)' },
      { status: 400 },
    );
  }

  const reviewerId =
    typeof reviewer_id === 'string' && reviewer_id.trim() ? reviewer_id.trim() : 'admin';
  const reviewNotes = typeof notes === 'string' && notes.trim() ? notes.trim() : undefined;

  const supabase = createDraymondAdminClient();
  const { data: action, error: loadError } = await supabase
    .from('draymond_actions')
    .select('*')
    .eq('id', id)
    .single();

  if (loadError || !action) {
    return NextResponse.json({ error: 'Action not found' }, { status: 404 });
  }

  // Already reviewed — idempotent double-submit guard.
  if (action.status !== 'pending_review') {
    return NextResponse.json(
      { error: `Action is not pending review (current status: ${action.status})` },
      { status: 409 },
    );
  }

  // ── Auth: CRON_SECRET Bearer OR per-action review token ──────────────────
  const cronAuthorized = authorizeRequest(request) === null;

  let tokenAuthorized = false;
  const headerToken = request.headers.get('x-review-token');
  const suppliedToken = headerToken || (typeof token === 'string' ? token : null);

  if (action.review_token && suppliedToken && safeTokenCompare(suppliedToken, action.review_token)) {
    const expiresAt = action.review_token_expires_at
      ? new Date(action.review_token_expires_at).getTime()
      : 0;
    if (expiresAt > 0 && Date.now() > expiresAt) {
      return NextResponse.json(
        { error: 'Review token expired — re-queue the action for a fresh link' },
        { status: 410 },
      );
    }
    tokenAuthorized = true;
  }

  if (!cronAuthorized && !tokenAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const reviewed = await reviewAction(id, reviewerId, approved, reviewNotes);
    return NextResponse.json({ ok: true, action: toPublicAction(reviewed) });
  } catch (err) {
    // reviewAction already guards status === pending_review; race with the
    // dashboard or a concurrent tap surfaces here.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to review action' },
      { status: 409 },
    );
  }
}
