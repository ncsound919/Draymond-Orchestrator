// ============================================================================
// GET /api/chat/attachments/[conversationId]/[file] — serve stored attachment
// ============================================================================
// Session-authed. Streams a stored chat attachment file back to the client.
// The conversation must belong to the current user and the filename must be a
// plain file name (path traversal is rejected by resolveAttachmentFile).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import { getConversation } from '@/lib/draymond/chat-store';
import { lookupMimeType, resolveAttachmentFile } from '@/lib/draymond/chat-attachments';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; file: string }> },
) {
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;

  const { conversationId, file } = await params;

  const conversation = await getConversation(conversationId, auth.user.id).catch(() => null);
  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const filePath = resolveAttachmentFile(conversationId, file);
  if (!filePath) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  const body = fs.readFileSync(filePath);
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': lookupMimeType(file),
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
