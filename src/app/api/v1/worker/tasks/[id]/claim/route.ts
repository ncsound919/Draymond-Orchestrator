// ============================================================================
// POST /api/v1/worker/tasks/:id/claim — Worker claims a queued task
// ============================================================================
// Claims a task for a worker (atomic queued → claimed transition). Returns
// 409 if the task is not claimable (already claimed, or does not exist).
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { claimTask } from '@/lib/draymond/worker-tasks';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { id } = await params;

  const { data: body, error: parseError } = await parseJsonBody<{
    worker_id?: string;
  }>(request);
  if (parseError) return parseError;

  try {
    const claimed = await claimTask(id, body.worker_id?.trim() || 'default');

    if (!claimed) {
      return NextResponse.json(
        { ok: false, error: 'task not claimable' },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[API /api/v1/worker/tasks/:id/claim]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
