// ============================================================================
// /api/command-center/seo — Command Center SEO task feed (command_seo_tasks)
// ============================================================================
// GET  /api/command-center/seo          — list tasks + counts
// POST /api/command-center/seo          — create task
// PATCH /api/command-center/seo          — update task (supports { action: 'done' | 'status' | 'priority' })
// DELETE /api/command-center/seo?id=     — delete task
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError, isValidId } from '@/lib/draymond/api-auth';
import {
  listSeoTasks,
  createSeoTask,
  updateSeoTask,
  setSeoTaskDone,
  setSeoTaskStatus,
  setSeoTaskPriority,
  deleteSeoTask,
  seoTaskCounts,
} from '@/lib/command-center/seo';
import type { SeoTaskInsert } from '@/lib/command-center/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const [tasks, counts] = await Promise.all([listSeoTasks(), seoTaskCounts()]);
    return NextResponse.json({ ok: true, tasks, counts });
  } catch (err) {
    console.error('[api/command-center/seo] GET', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const { data: body, error: parseError } = await parseJsonBody<SeoTaskInsert>(request);
  if (parseError) return parseError;
  try {
    if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
      return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 });
    }
    const task = await createSeoTask(body);
    return NextResponse.json({ ok: true, task }, { status: 201 });
  } catch (err) {
    console.error('[api/command-center/seo] POST', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const { data: body, error: parseError } = await parseJsonBody<Record<string, unknown>>(request);
  if (parseError) return parseError;
  try {
    const id = typeof body.id === 'string' ? body.id : null;
    if (!id || !isValidId(id)) {
      return NextResponse.json({ ok: false, error: 'Invalid or missing id' }, { status: 400 });
    }
    const action = body.action;
    let task;
    if (action === 'done') {
      task = await setSeoTaskDone(id, body.done === true);
    } else if (action === 'status') {
      task = await setSeoTaskStatus(id, body.status);
    } else if (action === 'priority') {
      task = await setSeoTaskPriority(id, body.priority);
    } else {
      const patch: Record<string, unknown> = {};
      for (const key of ['title', 'description', 'url', 'priority', 'status', 'owner', 'is_done', 'metadata', 'due_at', 'completed_at'] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ ok: false, error: 'No valid fields to update' }, { status: 400 });
      }
      task = await updateSeoTask(id, patch as Parameters<typeof updateSeoTask>[1]);
    }
    return NextResponse.json({ ok: true, task });
  } catch (err) {
    console.error('[api/command-center/seo] PATCH', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id || !isValidId(id)) {
      return NextResponse.json({ ok: false, error: 'Invalid or missing id' }, { status: 400 });
    }
    await deleteSeoTask(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/command-center/seo] DELETE', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
