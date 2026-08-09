/**
 * POST /api/chat
 * Draymond Chat — session-authenticated conversational orchestration.
 *
 * Accepts a turn and streams back an SSE response while Draymond routes the
 * latest user message to the right tool (entity / chain / status query /
 * web search / coding team / general chat / Uplift fallback).
 *
 * Request body (JSON):
 *   {
 *     conversationId?: string          // existing conversation to resume
 *     mode?: "send" | "regenerate" | "edit"
 *     content?: string                 // user text (send / edit)
 *     editMessageId?: string           // message being edited (edit)
 *     messages?: [{ role, content }]   // client-side transcript (new chats)
 *     attachments?: [{
 *       type: "image", name: string, mimeType: string, dataB64: string
 *     }]
 *   }
 *
 * The conversation + messages are persisted to the local SQLite store as the
 * turn streams. Response is text/event-stream (SSE):
 *   data: {"type":"start", ...}
 *   data: {"type":"user_message","message":{...}}        // persisted user msg
 *   data: {"type":"route","route":{...}}
 *   data: {"type":"text","content":"..."}
 *   data: {"type":"done","status":...,"message":{...}}   // persisted assistant msg
 *   data: [DONE]
 *
 * Auth: local admin session cookie (draymond_session).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import { appendAuditLog } from '@/lib/audit';
import { orchestrateChatTurn } from '@/lib/draymond/chat';
import type { ChatMessage } from '@/lib/draymond/chat';
import {
  appendMessages,
  autoTitleConversation,
  createConversation,
  deleteMessagesAfter,
  getConversation,
  getMessage,
  listMessages,
} from '@/lib/draymond/chat-store';
import { saveAttachment } from '@/lib/draymond/chat-attachments';
import type { AttachmentInput, AttachmentRecord } from '@/lib/draymond/chat-attachments';

export const dynamic = 'force-dynamic';

const MAX_MESSAGES = 50;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_ATTACHMENTS = 4;

type ChatMode = 'send' | 'regenerate' | 'edit';

function sseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseDone(): string {
  return 'data: [DONE]\n\n';
}

function parseChatMode(raw: unknown): ChatMode {
  return raw === 'regenerate' || raw === 'edit' ? raw : 'send';
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

  const mode = parseChatMode(body.mode);
  const conversationId =
    typeof body.conversationId === 'string' && body.conversationId.trim()
      ? body.conversationId.trim()
      : undefined;
  const editMessageId =
    typeof body.editMessageId === 'string' && body.editMessageId.trim()
      ? body.editMessageId.trim()
      : undefined;

  const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
  const attachments: AttachmentInput[] = rawAttachments
    .slice(0, MAX_ATTACHMENTS)
    .filter(
      (a): a is AttachmentInput =>
        !!a &&
        typeof a === 'object' &&
        (a as AttachmentInput).type === 'image' &&
        typeof (a as AttachmentInput).mimeType === 'string' &&
        typeof (a as AttachmentInput).dataB64 === 'string',
    );

  // ── Resolve the conversation + transcript ───────────────────────────────
  let conv = conversationId
    ? await getConversation(conversationId, auth.user.id).catch(() => null)
    : null;

  if (conversationId && !conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const rawContent = typeof body.content === 'string' ? body.content : '';

  // ── Edit: truncate after the edited message, then resend the new text ────
  if (mode === 'edit') {
    if (!conv || !editMessageId) {
      return NextResponse.json({ error: 'edit requires conversationId + editMessageId' }, { status: 400 });
    }
    const target = await getMessage(editMessageId, conv.id);
    if (!target || target.role !== 'user') {
      return NextResponse.json({ error: 'Message to edit not found' }, { status: 404 });
    }
    await deleteMessagesAfter(conv.id, editMessageId, auth.user.id);
    // Update the edited user message in place (content + attachments).
    const editAttachmentRecords: AttachmentRecord[] = [];
    for (const att of attachments) {
      editAttachmentRecords.push(await saveAttachment(conv.id, att));
    }
    const { getDb } = await import('@/lib/db/connection');
    getDb()
      .prepare('UPDATE draymond_messages SET content = ?, metadata = ? WHERE id = ?')
      .run(
        rawContent.slice(0, MAX_MESSAGE_LENGTH),
        JSON.stringify({
          ...(target.metadata ?? {}),
          ...(editAttachmentRecords.length ? { attachments: editAttachmentRecords } : {}),
        }),
        editMessageId,
      );
  }

  // ── Load the transcript fresh (after any edit/regenerate mutations) ─────
  let transcript: Awaited<ReturnType<typeof listMessages>> = [];
  let messageCount = 0;

  if (conv) {
    transcript = await listMessages(conv.id);
    messageCount = transcript.length;

    if (mode === 'regenerate' && transcript.length > 0) {
      const last = transcript[transcript.length - 1];
      if (last.role === 'assistant') {
        await deleteMessagesAfter(conv.id, last.id, auth.user.id);
        transcript = await listMessages(conv.id);
      }
    }
  }

  const toChatMessage = (m: { role: string; content: string }): ChatMessage => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content.slice(0, MAX_MESSAGE_LENGTH),
  });

  let task: string;
  let conversation: ChatMessage[] = [];

  if (mode === 'send') {
    task = rawContent.trim();
    if (!task && attachments.length > 0) {
      task = 'Describe or analyze the attached image(s).';
    }
    if (!task) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }
    conversation = transcript
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_MESSAGES)
      .map(toChatMessage);
  } else {
    // edit / regenerate — the final user message is the turn being re-run.
    if (transcript.length === 0) {
      return NextResponse.json({ error: 'Conversation has no messages' }, { status: 400 });
    }
    const last = transcript[transcript.length - 1];
    if (last.role !== 'user') {
      return NextResponse.json({ error: 'Cannot re-run: last message is not from the user' }, { status: 400 });
    }
    task = last.content.trim();
    conversation = transcript
      .slice(0, -1)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_MESSAGES)
      .map(toChatMessage);
  }

  // ── Create the conversation if needed, persist the user message ─────────
  let userMessageRecord: { id: string } | null = null;

  if (!conv) {
    conv = await createConversation(auth.user.id);
  }
  const activeConversationId = conv.id;

  if (mode === 'send') {
    const attachmentRecords: AttachmentRecord[] = [];
    for (const att of attachments) {
      attachmentRecords.push(await saveAttachment(activeConversationId, att));
    }
    const userMetadata: Record<string, unknown> = {
      source: 'dashboard-chat',
      ...(attachmentRecords.length ? { attachments: attachmentRecords } : {}),
    };
    const persisted = await appendMessages(activeConversationId, [
      {
        role: 'user',
        content: task.slice(0, MAX_MESSAGE_LENGTH),
        metadata: userMetadata,
      },
    ]);
    userMessageRecord = persisted[0] ?? null;

    if (messageCount === 0) {
      await autoTitleConversation(activeConversationId, auth.user.id, task);
    }
  }

  // ── Stream the turn ─────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const write = (chunk: string) => writer.write(encoder.encode(chunk));

  (async () => {
    try {
      await write(
        sseEvent({
          type: 'start',
          conversation_id: activeConversationId,
          user_id: auth.user.id,
          message_count: conversation.length,
          ...(userMessageRecord ? { user_message: userMessageRecord } : {}),
        }),
      );

      const result = await orchestrateChatTurn({
        task,
        conversation,
        metadata: {
          source: 'dashboard-chat',
          user_id: auth.user.id,
          user_email: auth.user.email,
          conversation_id: activeConversationId,
          attachments: attachments.map((a) => ({ mimeType: a.mimeType, dataB64: a.dataB64 })),
        },
        onChunk: (chunk) => write(sseEvent({ type: 'text', content: chunk })),
      });

      const assistantRecord = await appendMessages(activeConversationId, [
        {
          role: 'assistant',
          content: result.result.slice(0, 100_000),
          metadata: {
            source: 'dashboard-chat',
            status: result.status,
            intent: result.route?.intent,
            entity_slug: result.entity_slug,
            chain_slug: result.chain_slug,
          },
        },
      ]);
      const assistantMessage = assistantRecord[0] ?? null;

      await write(sseEvent({ type: 'done', status: result.status, result: result.result, message: assistantMessage }));
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
