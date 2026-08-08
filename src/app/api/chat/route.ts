/**
 * POST /api/chat
 * Draymond Chat — session-authenticated conversational orchestration.
 *
 * Accepts a conversation ({ messages: [{ role, content }] }) and streams back
 * an SSE response while Draymond routes the latest user message to the right
 * tool (entity / chain / status query / Uplift fallback).
 *
 * Request body (JSON):
 *   { messages: [{ role: "user" | "assistant", content: string }] }
 *
 * Auth: local admin session cookie (draymond_session). Unlike the external
 * /api/v1/orchestrate endpoint (CRON_SECRET bearer), this route is for the
 * logged-in dashboard user.
 *
 * Response: text/event-stream (SSE)
 *   data: {"type":"route","route":{...}}
 *   data: {"type":"text","content":"..."}
 *   data: [DONE]
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import { appendAuditLog } from '@/lib/audit';
import { orchestrateChatTurn } from '@/lib/draymond/chat';
import type { ChatMessage } from '@/lib/draymond/chat';

export const dynamic = 'force-dynamic';

const MAX_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 8000;

function sseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseDone(): string {
  return 'data: [DONE]\n\n';
}

export async function POST(request: NextRequest) {
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (rawMessages.length === 0) {
    return NextResponse.json(
      { error: 'messages is required and must be a non-empty array' },
      { status: 400 },
    );
  }

  const messages: ChatMessage[] = rawMessages
    .slice(-MAX_MESSAGES)
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === 'object' &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0,
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));

  if (messages.length === 0) {
    return NextResponse.json(
      { error: 'messages must contain at least one non-empty user message' },
      { status: 400 },
    );
  }

  const lastUserIndex = messages.reduce(
    (last, m, i) => (m.role === 'user' ? i : last),
    -1,
  );
  if (lastUserIndex === -1) {
    return NextResponse.json(
      { error: 'No user message found in conversation' },
      { status: 400 },
    );
  }

  const task = messages[lastUserIndex].content;
  const conversation = messages.slice(0, lastUserIndex);

  // Build a streaming response using TransformStream so we can write SSE
  // events as the turn progresses and flush them in real time.
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const write = (chunk: string) => writer.write(encoder.encode(chunk));

  (async () => {
    try {
      await write(
        sseEvent({
          type: 'start',
          user_id: auth.user.id,
          message_count: conversation.length,
        }),
      );

      const result = await orchestrateChatTurn({
        task,
        conversation,
        metadata: {
          source: 'dashboard-chat',
          user_id: auth.user.id,
          user_email: auth.user.email,
        },
        onChunk: (chunk) => write(sseEvent({ type: 'text', content: chunk })),
      });

      await write(sseEvent({ type: 'done', status: result.status, result: result.result }));
      await write(sseDone());

      await appendAuditLog({
        event: 'chat_stream_complete',
        status: result.status,
        intent: result.route?.intent,
        entity_slug: result.entity_slug,
        chain_slug: result.chain_slug,
        agent: 'draymond',
      });
    } catch (err) {
      console.error('[chat] stream error:', err);
      await write(
        sseEvent({
          type: 'error',
          message: 'An unexpected error occurred while processing your request.',
        }),
      );
      await write(sseDone());
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
