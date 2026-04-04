import { NextRequest, NextResponse } from 'next/server';
import { dispatchTask, UpliftTaskRequest } from '@/lib/uplift';
import { appendAuditLog } from '@/lib/audit';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const bodyResult = await parseJsonBody<UpliftTaskRequest>(request);
    if (bodyResult.error) return bodyResult.error;
    const body = bodyResult.data;

    if (!body.description || !body.agent) {
      return NextResponse.json({ error: 'description and agent are required' }, { status: 400 });
    }

    const task: UpliftTaskRequest = {
      task_id: body.task_id || `task-${Date.now()}`,
      description: body.description,
      agent: body.agent,
      context: body.context || {},
      session_id: body.session_id || `session-${Date.now()}`,
    };

    await appendAuditLog({
      event: 'uplift_task_dispatch',
      task_id: task.task_id,
      agent: task.agent,
      session_id: task.session_id,
      description: task.description,
    });

    const result = await dispatchTask(task);

    await appendAuditLog({
      event: 'uplift_task_complete',
      task_id: task.task_id,
      agent: task.agent,
      session_id: task.session_id,
    });

    return NextResponse.json({ task_id: task.task_id, result });
  } catch (error) {
    await appendAuditLog({
      event: 'uplift_task_error',
      error: error instanceof Error ? error.message : 'Unknown error',
      agent: 'uplift',
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Task dispatch failed' },
      { status: 500 }
    );
  }
}
