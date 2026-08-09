// ============================================================================
// GET/POST /api/chat/conversations — list / create chat conversations
// ============================================================================
// Session-authed. Lists the current user's conversations (newest first) or
// creates a new empty conversation.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import { createConversation, listConversations } from '@/lib/draymond/chat-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;

  try {
    const conversations = await listConversations(auth.user.id);
    return NextResponse.json({ conversations });
  } catch (err) {
    console.error('[api/chat/conversations] list failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list conversations' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;

  let title: string | undefined;
  try {
    const body = (await request.json()) as { title?: string };
    title = typeof body.title === 'string' ? body.title.slice(0, 200) : undefined;
  } catch {
    // Empty body is acceptable — title is optional
  }

  try {
    const conversation = await createConversation(auth.user.id, { title });
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (err) {
    console.error('[api/chat/conversations] create failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create conversation' },
      { status: 500 },
    );
  }
}
