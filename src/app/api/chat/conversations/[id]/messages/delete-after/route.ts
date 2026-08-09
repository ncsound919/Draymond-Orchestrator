// ============================================================================
// POST /api/chat/conversations/[id]/messages/delete-after — truncate transcript
// ============================================================================
// Session-authed. Deletes the message with `messageId` and every message after
// it (used by edit + regenerate before re-running the turn). 404 when the
// conversation is not the caller's or the message does not exist.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import { deleteMessagesAfter } from '@/lib/draymond/chat-store';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;

  const { id } = await params;

  let messageId: string | undefined;
  try {
    const body = (await request.json()) as { messageId?: string };
    messageId = typeof body.messageId === 'string' ? body.messageId : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!messageId) {
    return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
  }

  try {
    const ok = await deleteMessagesAfter(id, messageId, auth.user.id);
    if (!ok) {
      return NextResponse.json(
        { error: 'Conversation or message not found' },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/chat/delete-after] failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to truncate transcript' },
      { status: 500 },
    );
  }
}
