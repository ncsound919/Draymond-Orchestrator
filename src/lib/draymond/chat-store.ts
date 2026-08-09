// ============================================================================
// DRAYMOND — Chat Conversation Store (local SQLite)
// ============================================================================
// Persistence layer for the chat interface. Conversations live in
// `draymond_conversations`; messages reuse the existing `draymond_messages`
// table with `protocol = 'chat'`, `session_id` = conversation id, and a `seq`
// column for stable ordering (added to existing DBs via SCHEMA_UPGRADES).
//
// Pure server-side module — no Next.js request context — so it is
// unit-testable and reusable by any route handler. Every query is scoped by
// `userId` so one user can never read or mutate another's conversations.
// ============================================================================

import { createLocalAdminClient } from '@/lib/db';
import type { LocalClient } from '@/lib/db';
import { deleteConversationAttachments } from './chat-attachments';

export const CHAT_PROTOCOL = 'chat';

export interface ChatMessageRecord {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  protocol: string;
  metadata: Record<string, unknown>;
  seq: number;
  created_at: string;
}

export interface ConversationRecord {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** Number of messages in the conversation (populated by list queries). */
  message_count?: number;
  /** First ~120 chars of the latest message (populated by list queries). */
  preview?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
  preview: string;
}

export interface AppendMessageInput {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function client(): LocalClient {
  return createLocalAdminClient();
}

function toConversation(row: Record<string, unknown> | null | undefined): ConversationRecord | null {
  if (!row) return null;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: String(row.title ?? 'New chat'),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

// ── Conversations ────────────────────────────────────────────────────────────

export async function createConversation(
  userId: string,
  opts: { title?: string; id?: string } = {},
): Promise<ConversationRecord> {
  const { data, error } = await client()
    .from('draymond_conversations')
    .insert({ user_id: userId, title: opts.title ?? 'New chat', ...(opts.id ? { id: opts.id } : {}) })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create conversation: ${error?.message ?? 'no row returned'}`);
  }
  return toConversation(data as Record<string, unknown>)!;
}

export async function getConversation(
  conversationId: string,
  userId: string,
): Promise<ConversationRecord | null> {
  const { data, error } = await client()
    .from('draymond_conversations')
    .select()
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load conversation: ${error.message}`);
  }
  return toConversation(data as Record<string, unknown> | null);
}

export async function listConversations(userId: string, limit = 50): Promise<ConversationSummary[]> {
  const { data, error } = await client()
    .from('draymond_conversations')
    .select()
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list conversations: ${error.message}`);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const summaries: ConversationSummary[] = [];

  for (const row of rows) {
    const conv = toConversation(row);
    if (!conv) continue;
    const msgRes = await client()
      .from('draymond_messages')
      .select('id, role, content, created_at')
      .eq('session_id', conv.id)
      .eq('protocol', CHAT_PROTOCOL)
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle();

    let messageCount = 0;
    let preview = '';
    if (!msgRes.error && msgRes.data) {
      const latest = msgRes.data as Record<string, unknown>;
      messageCount = await countMessages(conv.id);
      const text = String(latest.content ?? '');
      preview = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    summaries.push({
      id: conv.id,
      title: conv.title,
      updated_at: conv.updated_at,
      message_count: messageCount,
      preview,
    });
  }

  return summaries;
}

async function countMessages(conversationId: string): Promise<number> {
  const { count } = await client()
    .from('draymond_messages')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', conversationId)
    .eq('protocol', CHAT_PROTOCOL);
  return count ?? 0;
}

export async function renameConversation(
  conversationId: string,
  userId: string,
  title: string,
): Promise<ConversationRecord | null> {
  const clean = title.trim().slice(0, 200);
  if (!clean) return null;

  const { data, error } = await client()
    .from('draymond_conversations')
    .update({ title: clean })
    .eq('id', conversationId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) return null;
  return toConversation(data as Record<string, unknown>);
}

export async function deleteConversation(conversationId: string, userId: string): Promise<boolean> {
  // Ownership check first — the builder's DELETE is a no-op (not an error) when
  // no rows match, so we can't rely on its error field to detect a foreign id.
  const conv = await getConversation(conversationId, userId);
  if (!conv) return false;

  const { error } = await client()
    .from('draymond_conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', userId);

  if (error) return false;

  // Best-effort cleanup of the transcript + stored attachment files.
  await client().from('draymond_messages').delete().eq('session_id', conversationId);
  deleteConversationAttachments(conversationId);
  return true;
}

/**
 * Rename to the auto-title derived from a user message (only when the
 * conversation is still using the default title).
 */
export async function autoTitleConversation(
  conversationId: string,
  userId: string,
  firstUserContent: string,
): Promise<void> {
  const conv = await getConversation(conversationId, userId);
  if (!conv || conv.title !== 'New chat') return;

  const title = deriveTitle(firstUserContent);
  await renameConversation(conversationId, userId, title);
}

export function deriveTitle(content: string): string {
  const text = content.replace(/\s+/g, ' ').trim();
  return text.slice(0, 60) || 'New chat';
}

// ── Messages ─────────────────────────────────────────────────────────────────

/** Next `seq` for a conversation (max + 1, starting at 1). */
export async function nextSeq(conversationId: string): Promise<number> {
  const { data, error } = await client()
    .from('draymond_messages')
    .select('seq')
    .eq('session_id', conversationId)
    .eq('protocol', CHAT_PROTOCOL)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return 1;
  const seq = (data as Record<string, unknown> | null)?.seq;
  return typeof seq === 'number' ? seq + 1 : 1;
}

export async function appendMessages(
  conversationId: string,
  messages: AppendMessageInput[],
  opts: { bump?: boolean } = { bump: true },
): Promise<ChatMessageRecord[]> {
  if (messages.length === 0) return [];

  const db = client();
  let seq = await nextSeq(conversationId);
  const now = new Date().toISOString();

  const rows = messages.map((m) => ({
    ...(m.id ? { id: m.id } : {}),
    session_id: conversationId,
    role: m.role,
    content: m.content,
    protocol: CHAT_PROTOCOL,
    metadata: m.metadata ?? {},
    seq: seq++,
    created_at: now,
  }));

  const { data, error } = await db
    .from('draymond_messages')
    .insert(rows)
    .select();

  if (error) {
    throw new Error(`Failed to append messages: ${error.message}`);
  }

  if (opts.bump) {
    await client()
      .from('draymond_conversations')
      .update({ updated_at: now })
      .eq('id', conversationId);
  }

  return ((data ?? []) as ChatMessageRecord[]).sort((a, b) => a.seq - b.seq);
}

export async function listMessages(conversationId: string): Promise<ChatMessageRecord[]> {
  const { data, error } = await client()
    .from('draymond_messages')
    .select()
    .eq('session_id', conversationId)
    .eq('protocol', CHAT_PROTOCOL)
    .order('seq', { ascending: true });

  if (error) {
    throw new Error(`Failed to load messages: ${error.message}`);
  }
  return (data ?? []) as ChatMessageRecord[];
}

export async function getMessage(
  messageId: string,
  conversationId: string,
): Promise<ChatMessageRecord | null> {
  const { data, error } = await client()
    .from('draymond_messages')
    .select()
    .eq('id', messageId)
    .eq('session_id', conversationId)
    .maybeSingle();

  if (error || !data) return null;
  return data as ChatMessageRecord;
}

/** Delete every message at or after `messageId` (edit / regenerate truncation). */
export async function deleteMessagesAfter(
  conversationId: string,
  messageId: string,
  userId: string,
): Promise<boolean> {
  const conv = await getConversation(conversationId, userId);
  if (!conv) return false;

  const target = await getMessage(messageId, conversationId);
  if (!target) return false;

  const { error } = await client()
    .from('draymond_messages')
    .delete()
    .eq('session_id', conversationId)
    .gte('seq', target.seq);

  if (error) return false;

  await client()
    .from('draymond_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  return true;
}
