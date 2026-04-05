/**
 * GET  /api/v1/workflows/[id]  — get workflow status
 * DELETE /api/v1/workflows/[id] — cancel a workflow
 *
 * Open-Chat's DraymondOrchestratorClient polls this endpoint to track
 * multi-agent workflow progress and cancels workflows on user abort.
 *
 * Because orchestrations are dispatched to Uplift (which manages its own
 * state), this route queries Uplift for the task status and normalises
 * the response to the shape Open-Chat expects.
 *
 * Auth: Bearer token checked against CRON_SECRET env var.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { getTaskStatus } from '@/lib/uplift';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'Workflow ID is required' }, { status: 400 });
  }

  try {
    const raw = await getTaskStatus(id) as Record<string, unknown>;

    // Normalise to the shape Open-Chat expects
    return NextResponse.json({
      id,
      status: (raw?.status as string) ?? 'in_progress',
      current_phase: (raw?.current_phase as string) ?? null,
      recent_executions: (raw?.executions as unknown[]) ?? [],
      started_at: (raw?.started_at as string) ?? null,
      completed_at: (raw?.completed_at as string) ?? null,
    });
  } catch (err) {
    // Uplift may not know about this workflow (e.g. it was completed already)
    // Return a safe default rather than a 500 so Open-Chat stops polling.
    return NextResponse.json({
      id,
      status: 'completed',
      current_phase: null,
      recent_executions: [],
      error: err instanceof Error ? err.message : 'Status unavailable',
    });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'Workflow ID is required' }, { status: 400 });
  }

  // Best-effort cancel — Uplift may have already completed the task.
  // We always return 200 so Open-Chat marks the workflow as cancelled locally.
  try {
    const UPLIFT_BASE_URL = process.env.UPLIFT_BASE_URL ?? 'http://localhost:8000';
    const res = await fetch(`${UPLIFT_BASE_URL}/task/${id}/cancel`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 404) {
      console.warn(`[api/v1/workflows] Cancel returned ${res.status} for ${id}`);
    }
  } catch {
    // Uplift offline or task not found — still acknowledge the cancel
  }

  return NextResponse.json({ ok: true, id, status: 'cancelled' });
}
