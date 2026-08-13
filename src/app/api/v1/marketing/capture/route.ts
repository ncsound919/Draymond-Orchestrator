// ============================================================================
// POST /api/v1/marketing/capture — queue an Open-Chat phone content capture
// ============================================================================
// Enqueues a `marketing_capture` worker task. Open Chat's worker pulls it,
// opens the target app, screenshots the content, uploads it to the SMD media
// store, and reports the screen text + screenshot back to Draymond.
//
// Body: { app?: string, prompt?: string, skill_pack_id?: string }
// Auth: CRON_SECRET Bearer.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';
import { enqueueWorkerTask } from '@/lib/draymond/worker-tasks';
import { appendAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    app?: string;
    prompt?: string;
    skill_pack_id?: string;
  }>(request);
  if (parseError) return parseError;

  try {
    const skillPackId = body.skill_pack_id ?? 'marketing_capture:1.0.0';
    const id = await enqueueWorkerTask({
      skill_pack_id: skillPackId,
      payload: {
        app: body.app ?? '',
        prompt: body.prompt ?? '',
        source: 'api/marketing-capture',
      },
    });

    await appendAuditLog({ event: 'marketing.capture_enqueued', worker_task_id: id });

    return NextResponse.json(
      { ok: true, task_id: id, skill_pack_id: skillPackId },
      { status: 201 },
    );
  } catch (err) {
    console.error('[API /api/v1/marketing/capture]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
