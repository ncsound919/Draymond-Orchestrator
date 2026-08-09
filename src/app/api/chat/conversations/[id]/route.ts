// ============================================================================
// GET/PATCH/DELETE /api/chat/conversations/[id] — get / rename / delete
// ============================================================================
// Session-authed. All operations are scoped to the current user — a
// conversation owned by someone else behaves as if it does not exist (404).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import {
  deleteConversation,
  getConversation,
  renameConversation,
} from '@/lib/draymond/chat-store';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;

  const { id } = await params;

  try {
    const conversation = await getConversation(id, auth.user.id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return NextResponse.json({ conversation });
  } catch (err) {
    console.error('[api/chat/conversations/:id] load failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load conversation' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;

  const { id } = await params;

  let title: string | undefined;
  try {
    const body = (await request.json()) as { title?: string };
    title = typeof body.title === 'string' ? body.title : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  try {
    const conversation = await renameConversation(id, auth.user.id, title);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return NextResponse.json({ conversation });
  } catch (err) {
    console.error('[api/chat/conversations/:id] rename failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to rename conversation' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;

  const { id } = await params;

  try {
    const deleted = await deleteConversation(id, auth.user.id);
    if (!deleted) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/chat/conversations/:id] delete failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete conversation' },
      { status: 500 },
    );
  }
}
