// ============================================================================
// GET /api/chat/conversations/[id]/messages — full transcript
// ============================================================================
// Session-authed. Returns the ordered message transcript for the current
// user's conversation (404 for foreign / missing conversations).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import { getConversation, listMessages } from '@/lib/draymond/chat-store';

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

    const messages = await listMessages(id);
    return NextResponse.json({ conversation, messages });
  } catch (err) {
    console.error('[api/chat/conversations/:id/messages] load failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load messages' },
      { status: 500 },
    );
  }
}
