/**
 * GET  /api/v1/workflows/[id]  — get workflow status
 * DELETE /api/v1/workflows/[id] — cancel a workflow
 *
 * Auth: Bearer token checked against CRON_SECRET env var.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { getTaskStatus } from '@/lib/uplift';

export const dynamic = 'force-dynamic';

/** Workflow IDs must be alphanumeric, hyphens, underscores (max 128 chars). */
const WORKFLOW_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { id } = await context.params;
  if (!id || !WORKFLOW_ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid or missing workflow ID' }, { status: 400 });
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
  } catch {
    // Uplift may not know about this workflow (e.g. it was completed already)
    // Return 'unknown' rather than 'completed' to avoid misleading the client.
    return NextResponse.json({
      id,
      status: 'unknown',
      current_phase: null,
      recent_executions: [],
    });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { id } = await context.params;
  if (!id || !WORKFLOW_ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid or missing workflow ID' }, { status: 400 });
  }

  // Best-effort cancel — Uplift may have already completed the task.
  try {
    const UPLIFT_BASE_URL = process.env.UPLIFT_BASE_URL ?? 'http://localhost:8000';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = process.env.UPLIFT_API_KEY;
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(`${UPLIFT_BASE_URL}/task/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      headers,
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
