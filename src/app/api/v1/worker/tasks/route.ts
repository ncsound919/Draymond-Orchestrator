// ============================================================================
// /api/v1/worker/tasks — Worker task queue (GET & POST)
// ============================================================================
// GET  — Pull due tasks for a worker (queue / assignment protocol)
// POST — Enqueue a new task from the boss (Draymond)
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { enqueueWorkerTask, pullDueTasks } from '@/lib/draymond/worker-tasks';
import { appendAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// ── GET /api/v1/worker/tasks ────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);

    const workerId = url.searchParams.get('worker_id')?.trim() || 'default';

    // Cap limit to prevent abuse
    const limitRaw = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(50, parseInt(limitRaw ?? '10', 10) || 10));

    const tasks = await pullDueTasks(workerId, limit);
    return NextResponse.json({ ok: true, tasks });
  } catch (err) {
    console.error('[API /api/v1/worker/tasks GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// ── POST /api/v1/worker/tasks ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    skill_pack_id?: string;
    payload?: Record<string, unknown>;
    due_at?: string;
  }>(request);
  if (parseError) return parseError;

  try {
    const id = await enqueueWorkerTask({
      skill_pack_id: body.skill_pack_id,
      payload: body.payload,
      due_at: body.due_at,
    });

    await appendAuditLog({ event: 'worker.task.enqueued' });

    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    console.error('[API /api/v1/worker/tasks POST]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
