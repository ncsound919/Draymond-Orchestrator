'use client';

// ============================================================================
// ChatClient — Draymond chat interface (persistent, streaming)
// ============================================================================
// Rewritten around server-persisted conversations:
//   - loads the transcript for a conversation id (or starts fresh)
//   - optimistic UI with SSE streaming
//   - stop generation, regenerate, inline edit
//   - image attachments (upload, paste, drag-drop) with client-side compression
// Renders assistant output through the dependency-free Markdown renderer.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrchestratorHealth } from '@/hooks/useOrchestratorHealth';
import { emitChatEvent } from '@/lib/chat-events';
import Markdown from './Markdown';
import {
  Paperclip,
  Plus,
  RotateCw,
  Send,
  SquarePen,
  Stop,
  XMark,
} from './markdown-icons';

// -- Types --------------------------------------------------------------------

interface ServerMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  protocol: string;
  metadata: Record<string, unknown> | string;
  seq: number;
  created_at: string;
}

interface StoredAttachment {
  id: string;
  type: 'image';
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

interface LocalAttachment {
  id: string;
  type: 'image';
  name: string;
  mimeType: string;
  size: number;
  url?: string;
  dataUrl?: string;
}

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  stopped?: boolean;
  error?: boolean;
  attachments?: LocalAttachment[];
}

interface SseEvent {
  type?: string;
  content?: string;
  error?: string;
  message?: string;
  conversation_id?: string;
  user_message?: { id?: string };
}

interface ComposerAttachment extends LocalAttachment {
  dataUrl: string;
}

interface ChatClientProps {
  userEmail?: string;
  conversationId?: string;
  initialTitle?: string;
  initialMessages?: ServerMessage[];
}

// -- Helpers ------------------------------------------------------------------

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseMetadata(raw: ServerMessage['metadata']): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw;
}

function toLocalMessage(m: ServerMessage): LocalMessage {
  const metadata = parseMetadata(m.metadata);
  const attachments = Array.isArray(metadata.attachments)
    ? (metadata.attachments as StoredAttachment[])
    : [];
  return {
    id: m.id,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
    attachments: attachments.length
      ? attachments.map((a) => ({
          id: a.id,
          type: 'image',
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          url: a.url,
        }))
      : undefined,
  };
}

const ROUTE_PILL_RE = /^\n?\[([a-z_]+) → ([^\]]+)\] \((\d+)%\)\n\n/;

function routePill(content: string): { pill: { intent: string; target: string; confidence: string } | null; rest: string } {
  const m = content.match(ROUTE_PILL_RE);
  if (!m) return { pill: null, rest: content };
  return {
    pill: { intent: m[1], target: m[2], confidence: m[3] },
    rest: content.slice(m[0].length),
  };
}

async function processImageFile(file: File): Promise<ComposerAttachment | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const dataUrl = await compressImage(file);
    return {
      id: makeId(),
      type: 'image',
      name: file.name || 'image',
      mimeType: file.type === 'image/svg+xml' ? 'image/png' : file.type,
      size: Math.round((dataUrl.length * 3) / 4),
      dataUrl,
    };
  } catch {
    return null;
  }
}

async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', 0.85);
}

function dataUrlToB64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

// -- Component ----------------------------------------------------------------

export default function ChatClient({
  userEmail,
  conversationId: propConversationId,
  initialTitle,
  initialMessages,
}: ChatClientProps) {
  const router = useRouter();
  const health = useOrchestratorHealth();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(propConversationId);
  const [conversationTitle, setConversationTitle] = useState<string | undefined>(initialTitle);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const initialMessagesRef = useRef(initialMessages);
  // Keep the ref current in an effect (writing refs during render is unsafe and
  // flagged by react-hooks/refs). Declared before the reset effect so it runs
  // first in the same commit.
  useEffect(() => {
    initialMessagesRef.current = initialMessages;
  }, [initialMessages]);

  // Reset when navigating between conversations.
  useEffect(() => {
    setMessages((initialMessagesRef.current ?? []).map(toLocalMessage));
    setConversationId(propConversationId);
    setConversationTitle(initialTitle);
    setSending(false);
    setComposerAttachments([]);
    setEditingId(null);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [propConversationId, initialTitle]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // -- Message mutation helpers ---------------------------------------------

  const appendChunk = useCallback((assistantId: string, chunk: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk, pending: true } : m)),
    );
  }, []);

  const finalizeAssistant = useCallback(
    (assistantId: string, opts?: { error?: boolean; stopped?: boolean; id?: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                pending: false,
                error: opts?.error ?? m.error,
                stopped: opts?.stopped ?? m.stopped,
                id: opts?.id ?? m.id,
              }
            : m,
        ),
      );
    },
    [],
  );

  const updateMessageId = useCallback((fromId: string, toId: string) => {
    setMessages((prev) => prev.map((m) => (m.id === fromId ? { ...m, id: toId } : m)));
  }, []);

  // -- Turn runner ----------------------------------------------------------

  const runTurn = useCallback(
    async (opts: { content?: string; mode?: 'send' | 'regenerate' | 'edit'; editMessageId?: string }) => {
      const text = (opts.content ?? '').trim();
      const mode = opts.mode ?? 'send';

      if (mode === 'send' && !text && composerAttachments.length === 0) return;
      if (sending) return;

      const attachmentsPayload = composerAttachments.map((a) => ({
        type: 'image' as const,
        name: a.name,
        mimeType: a.mimeType,
        dataB64: dataUrlToB64(a.dataUrl),
      }));

      const optimisticUser: LocalMessage = {
        id: makeId(),
        role: 'user',
        content: text,
        attachments: composerAttachments.map((a) => ({ ...a, url: undefined })),
      };
      const optimisticAssistant: LocalMessage = {
        id: makeId(),
        role: 'assistant',
        content: '',
        pending: true,
      };

      setInput('');
      setComposerAttachments([]);
      setEditingId(null);
      setSending(true);

      let assistantId = optimisticAssistant.id;

      if (mode === 'send') {
        setMessages((prev) => [...prev, optimisticUser, optimisticAssistant]);
      } else if (mode === 'regenerate') {
        // Drop the trailing assistant reply, replace it with a fresh placeholder.
        setMessages((prev) => {
          const next = prev.filter((m) => m.pending === true).length > 0 ? prev : prev.slice();
          while (next.length > 0 && next[next.length - 1].role === 'assistant') next.pop();
          next.push(optimisticAssistant);
          return next;
        });
      } else if (mode === 'edit' && opts.editMessageId) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === opts.editMessageId);
          if (idx === -1) return [...prev, optimisticAssistant];
          const next = prev.slice(0, idx + 1);
          next[idx] = {
            ...next[idx],
            content: text,
            attachments: composerAttachments.map((a) => ({ ...a, url: undefined })),
          };
          next.push(optimisticAssistant);
          return next;
        });
      }

      const controller = new AbortController();
      abortRef.current = controller;

      const payload: Record<string, unknown> = {
        conversationId,
        mode,
        content: text,
      };
      if (mode === 'edit' && opts.editMessageId) payload.editMessageId = opts.editMessageId;
      if (mode === 'send' && attachmentsPayload.length > 0) payload.attachments = attachmentsPayload;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => '');
          let msg = `Request failed (${res.status}).`;
          try {
            const parsed = JSON.parse(detail) as { error?: string };
            if (parsed.error) msg = parsed.error;
          } catch {
            // ignore non-JSON body
          }
          appendChunk(assistantId, msg);
          finalizeAssistant(assistantId, { error: true });
          setSending(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';

          for (const event of events) {
            for (const line of event.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (data === '[DONE]') continue;

              let parsed: SseEvent | null = null;
              try {
                parsed = JSON.parse(data) as SseEvent;
              } catch {
                continue;
              }

              if (!parsed) continue;

              if (parsed.type === 'start') {
                // First persisted turn → adopt the server conversation id + navigate.
                if (parsed.conversation_id && conversationId !== parsed.conversation_id) {
                  const newId = parsed.conversation_id;
                  setConversationId(newId);
                  router.replace(`/chat/${newId}`);
                  emitChatEvent({ type: 'conversation-created', id: newId });
                }
                if (parsed.user_message?.id) {
                  updateMessageId(optimisticUser.id, parsed.user_message.id);
                }
              } else if (parsed.type === 'text' && typeof parsed.content === 'string') {
                appendChunk(assistantId, parsed.content);
              } else if (parsed.type === 'done') {
                if (parsed.message) {
                  const rec = parsed.message as unknown as { id?: string };
                  if (typeof rec?.id === 'string') assistantId = rec.id;
                }
                finalizeAssistant(assistantId, {});
              } else if (parsed.type === 'error') {
                appendChunk(assistantId, parsed.error ?? 'An unexpected error occurred.');
                finalizeAssistant(assistantId, { error: true });
              }
            }
          }
        }

        finalizeAssistant(assistantId, {});
        emitChatEvent({ type: 'conversation-updated' });
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        if (aborted) {
          finalizeAssistant(assistantId, { stopped: true });
        } else {
          appendChunk(
            assistantId,
            `Network error: ${err instanceof Error ? err.message : String(err)}`,
          );
          finalizeAssistant(assistantId, { error: true });
        }
      } finally {
        setSending(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [appendChunk, composerAttachments, conversationId, finalizeAssistant, router, sending, updateMessageId],
  );

  // -- Composer attachment handlers -----------------------------------------

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    const processed: ComposerAttachment[] = [];
    for (const file of list) {
      if (composerAttachments.length + processed.length >= 4) break;
      const att = await processImageFile(file);
      if (att) processed.push(att);
    }
    if (processed.length > 0) setComposerAttachments((prev) => [...prev, ...processed]);
  }, [composerAttachments.length]);

  const onPaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const files = items
        .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length > 0) {
        e.preventDefault();
        await addFiles(files);
      }
    },
    [addFiles],
  );

  const newChat = useCallback(() => {
    if (sending) abortRef.current?.abort();
    router.push('/chat');
  }, [router, sending]);

  const startEdit = useCallback((msg: LocalMessage) => {
    setEditingId(msg.id);
    setEditingValue(msg.content);
    setComposerAttachments((msg.attachments ?? []).filter((a): a is ComposerAttachment => !!a.dataUrl));
    inputRef.current?.focus();
  }, []);

  // -- Render ---------------------------------------------------------------

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            'radial-gradient(ellipse 60% 100% at 50% -10%, rgba(34,197,94,0.10), transparent 70%)',
        }}
        aria-hidden="true"
      />

      {/* -- Header ------------------------------------------------------- */}
      <header className="relative z-10 border-b border-white/5 bg-black/40 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="animate-chat-orb relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#22c55e] to-[#16a34a] text-sm font-bold text-black">
              D
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight text-white">
                {conversationTitle && conversationTitle !== 'New chat' ? conversationTitle : 'Draymond Assistant'}
              </p>
              <p className="flex items-center gap-1.5 text-[11px] leading-tight text-gray-500">
                <span
                  role="status"
                  className={`h-1.5 w-1.5 rounded-full ${
                    health === 'online'
                      ? 'bg-green-500 animate-pulse'
                      : health === 'offline'
                        ? 'bg-red-500'
                        : 'bg-gray-500'
                  }`}
                />
                {health === 'online'
                  ? 'Online · routes to the right tool'
                  : health === 'offline'
                    ? 'Orchestrator unreachable'
                    : 'Connecting…'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={newChat}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                New chat
              </button>
            )}
          </div>
        </div>
      </header>

      {/* -- Messages ----------------------------------------------------- */}
      <div
        ref={scrollRef}
        className={`relative z-0 flex-1 min-h-0 overflow-y-auto ${dragOver ? 'bg-[#22c55e]/5' : ''}`}
      >
        <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
          {messages.length === 0 ? (
            <div className="animate-chat-fade-up flex h-full min-h-[55vh] flex-col items-center justify-center text-center">
              <div className="animate-chat-orb flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#22c55e] to-[#16a34a] text-2xl font-bold text-black">
                D
              </div>
              <h2 className="mt-6 text-xl font-bold tracking-tight text-white sm:text-2xl">
                What can <span className="text-chat-shimmer">Draymond</span> do for you?
              </h2>
              <p className="mt-2 max-w-md text-sm text-gray-500">
                Ask for status, run an entity or chain, describe a task, or paste an
                image. Draymond routes it to the right tool automatically.
              </p>
              <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => void runTurn({ content: s.task, mode: 'send' })}
                    disabled={sending}
                    className="glass-card group flex items-center gap-3 p-3 text-left disabled:opacity-50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#22c55e]/10 text-[#4ade80] transition-colors group-hover:bg-[#22c55e]/20">
                      {s.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-white">{s.label}</span>
                      <span className="block truncate text-xs text-gray-500">{s.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                editing={editingId === m.id}
                editingValue={editingValue}
                onEditingValueChange={setEditingValue}
                onSaveEdit={() => void runTurn({ content: editingValue, mode: 'edit', editMessageId: editingId ?? undefined })}
                onCancelEdit={() => setEditingId(null)}
                onEdit={() => startEdit(m)}
                onRegenerate={
                  m.role === 'assistant' && !m.pending && m.id === lastAssistantId
                    ? () => void runTurn({ mode: 'regenerate' })
                    : undefined
                }
              />
            ))
          )}
        </div>
      </div>

      {/* -- Composer ----------------------------------------------------- */}
      <div className="relative z-10 border-t border-white/5 bg-black/40 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">
          {composerAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {composerAttachments.map((att) => (
                <span
                  key={att.id}
                  className="group relative flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-1 pr-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={att.dataUrl} alt={att.name} className="h-10 w-10 rounded-lg object-cover" />
                  <span className="max-w-[140px] truncate text-xs text-gray-300">{att.name}</span>
                  <button
                    onClick={() => setComposerAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                    className="rounded-md p-0.5 text-gray-500 hover:bg-white/10 hover:text-white"
                    aria-label="Remove attachment"
                  >
                    <XMark className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div
            className={`rounded-2xl border p-1.5 transition-all duration-200 ${
              dragOver
                ? 'border-[#22c55e]/60 bg-[#22c55e]/10 shadow-[0_0_0_3px_rgba(34,197,94,0.12)]'
                : 'border-white/10 bg-white/[0.04] focus-within:border-[#22c55e]/40 focus-within:bg-white/[0.06] focus-within:shadow-[0_0_0_3px_rgba(34,197,94,0.08)]'
            }`}
          >
            <div className="flex items-end gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                aria-label="Attach image"
                className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={onPaste}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (sending) return;
                    void runTurn({ content: input, mode: 'send' });
                  }
                }}
                placeholder="Describe a task, ask for status, or name an entity or chain…"
                rows={1}
                disabled={sending}
                className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 disabled:opacity-50"
              />
              {sending ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  aria-label="Stop generating"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 transition-all hover:bg-red-500/20 active:scale-95"
                >
                  <Stop className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={() => void runTurn({ content: input, mode: 'send' })}
                  disabled={!input.trim() && composerAttachments.length === 0}
                  aria-label="Send message"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#22c55e] to-[#16a34a] text-black transition-all hover:shadow-lg hover:shadow-[#22c55e]/25 active:scale-95 disabled:opacity-30 disabled:hover:shadow-none"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between px-1">
            <p className="text-[10px] text-gray-600">
              Enter to send &middot; Shift+Enter for a new line &middot; paste or drop images
            </p>
            <p className="hidden text-[10px] text-gray-600 sm:block">
              {userEmail ? `Signed in as ${userEmail}` : 'Powered by the Draymond intelligent router'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Message row --------------------------------------------------------------

interface MessageRowProps {
  message: LocalMessage;
  editing: boolean;
  editingValue: string;
  onEditingValueChange: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEdit: () => void;
  onRegenerate?: () => void;
}

function MessageRow({
  message: m,
  editing,
  editingValue,
  onEditingValueChange,
  onSaveEdit,
  onCancelEdit,
  onEdit,
  onRegenerate,
}: MessageRowProps) {
  const { pill, rest } = routePill(m.role === 'assistant' ? m.content : '');

  return (
    <div className={`animate-chat-fade-up group flex items-start gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
      {m.role === 'assistant' ? (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#22c55e]/80 to-[#16a34a]/60 text-xs font-bold text-black shadow-lg shadow-[#22c55e]/10">
          D
        </div>
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-gray-400">
          <UserIcon />
        </div>
      )}

      <div
        className={`max-w-[82%] text-sm leading-relaxed ${
          m.role === 'user'
            ? 'rounded-2xl rounded-br-md border border-[#22c55e]/20 bg-gradient-to-br from-[#22c55e]/25 to-[#22c55e]/10 px-4 py-2.5 text-white shadow-lg shadow-[#22c55e]/5'
            : m.error
              ? 'rounded-2xl rounded-bl-md border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-red-300'
              : 'rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-4 py-2.5 text-gray-200 backdrop-blur-sm'
        }`}
      >
        {m.role === 'assistant' && m.pending && !m.content ? (
          <span className="flex items-center gap-2 py-1">
            <span className="text-xs text-gray-500">Draymond is working</span>
            <span className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80] animate-bounce" />
              <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80] animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80] animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          </span>
        ) : editing ? (
          <div className="space-y-2">
            <textarea
              value={editingValue}
              onChange={(e) => onEditingValueChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSaveEdit();
                }
                if (e.key === 'Escape') onCancelEdit();
              }}
              autoFocus
              rows={3}
              className="w-full resize-y rounded-lg border border-white/10 bg-black/30 p-2 text-sm text-white outline-none focus:border-[#22c55e]/40"
            />
            <div className="flex items-center justify-end gap-2">
              <button onClick={onCancelEdit} className="rounded-lg px-2 py-1 text-xs text-gray-400 hover:bg-white/10">
                Cancel
              </button>
              <button
                onClick={onSaveEdit}
                className="rounded-lg bg-[#22c55e]/20 px-2.5 py-1 text-xs font-medium text-[#4ade80] hover:bg-[#22c55e]/30"
              >
                Save &amp; resend
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {m.attachments && m.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {m.attachments.map((att) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={att.id}
                    src={att.url ?? att.dataUrl}
                    alt={att.name}
                    className="max-h-48 rounded-lg border border-white/10 object-cover"
                  />
                ))}
              </div>
            )}
            {m.role === 'assistant' ? (
              <div className="space-y-2.5">
                {pill && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22c55e]/25 bg-[#22c55e]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#4ade80]">
                    {pill.intent.replace(/_/g, ' ')} &rarr; {pill.target}
                    <span className="rounded-full bg-[#22c55e]/20 px-1.5 py-px font-mono text-[9px]">{pill.confidence}%</span>
                  </span>
                )}
                <Markdown source={rest} />
                {m.stopped && (
                  <p className="text-xs italic text-gray-500">Generation stopped.</p>
                )}
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words">{m.content}</p>
            )}
          </div>
        )}
      </div>

      {/* Message actions */}
      {!editing && !m.pending && (
        <div
          className={`flex items-center gap-0.5 self-center opacity-0 transition-opacity group-hover:opacity-100 ${
            m.role === 'user' ? 'flex-row-reverse' : ''
          }`}
        >
          {m.role === 'user' && (
            <button
              onClick={onEdit}
              className="rounded-md p-1 text-gray-500 hover:bg-white/10 hover:text-white"
              aria-label="Edit message"
            >
              <SquarePen className="h-3.5 w-3.5" />
            </button>
          )}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="rounded-md p-1 text-gray-500 hover:bg-white/10 hover:text-white"
              aria-label="Regenerate response"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// -- Suggestions --------------------------------------------------------------

const SUGGESTIONS = [
  { icon: <ActivityIcon />, label: 'System status', hint: 'Overview & health', task: 'Show me the current system status' },
  { icon: <CheckIcon />, label: 'Pending approvals', hint: 'Awaiting review', task: 'What actions are pending approval?' },
  { icon: <BranchIcon />, label: 'Research Pipeline', hint: 'Run a chain', task: 'Run the Research Pipeline chain' },
  { icon: <HeartIcon />, label: 'Agent health', hint: 'Fleet check-up', task: 'Check the health of all agents' },
  { icon: <HeadsetIcon />, label: 'AetherDesk', hint: 'Call center ops', task: 'List the AetherDesk agents' },
  { icon: <SparklesIcon />, label: 'General task', hint: 'Ask anything', task: 'Draft a plan for launching a new feature' },
];

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="m9 11 3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
function BranchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}
function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
    </svg>
  );
}
function HeadsetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm18 0h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-5Z" />
      <path d="M21 11v2a9 9 0 0 1-9 9h-2" />
    </svg>
  );
}
function SparklesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </svg>
  );
}
