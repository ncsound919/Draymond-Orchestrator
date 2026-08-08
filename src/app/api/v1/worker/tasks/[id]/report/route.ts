// ============================================================================
// POST /api/v1/worker/tasks/:id/report — Worker reports task completion/failure
// ============================================================================
// Reports the outcome of a claimed task. A successful report also records a
// self-learning outcome (non-fatal if the learning loop is unavailable).
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { reportTask } from '@/lib/draymond/worker-tasks';
import { recordOutcome } from '@/lib/draymond/self-learning';
import { appendAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { id } = await params;

  const { data: body, error: parseError } = await parseJsonBody<{
    result?: Record<string, unknown>;
    artifact_refs?: string[];
    error?: string;
    worker_id?: string;
    skill_pack_id?: string;
  }>(request);
  if (parseError) return parseError;

  try {
    const workerId = body.worker_id?.trim() || undefined;

    const reported = await reportTask(
      id,
      body.result ?? {},
      body.artifact_refs ?? [],
      body.error,
      workerId,
    );

    if (!reported) {
      return NextResponse.json(
        { ok: false, error: 'task not reportable' },
        { status: 409 },
      );
    }

    if (!body.error) {
      recordOutcome({
        agentId: workerId ?? 'open-chat',
        kind: 'job',
        summary: `worker task ${id}`,
        success: true,
        detail: JSON.stringify(body.result ?? {}).slice(0, 1000),
      }).catch(() => {});
    }

    await appendAuditLog({
      event: body.error ? 'worker.task.failed' : 'worker.task.completed',
      session_id: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[API /api/v1/worker/tasks/:id/report]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
