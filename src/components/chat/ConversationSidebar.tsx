'use client';

// ============================================================================
// ConversationSidebar — persistent chat history list
// ============================================================================
// Lists the user's conversations (newest first), with search, inline rename,
// delete, and a "New chat" action. Active state follows the URL. Refreshes
// itself when ChatClient emits conversation events.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { onChatEvent } from '@/lib/chat-events';
import { Plus, Search, SquarePen, Trash, XMark } from './markdown-icons';

interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
  preview: string;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

export default function ConversationSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  const activeId = useMemo(() => {
    const match = pathname?.match(/^\/chat\/([^/]+)/);
    return match ? match[1] : undefined;
  }, [pathname]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/conversations', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { conversations?: ConversationSummary[] };
      setConversations(data.conversations ?? []);
    } catch {
      // offline / transient — keep the current list
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
     
    void refresh();
    return onChatEvent(() => void refresh());
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  function startRename(conv: ConversationSummary) {
    setEditingId(conv.id);
    setEditingValue(conv.title);
    setConfirmDeleteId(null);
    setTimeout(() => editRef.current?.focus(), 0);
  }

  async function commitRename() {
    const id = editingId;
    if (!id) return;
    const title = editingValue.trim();
    setEditingId(null);
    if (!title) return;
    try {
      await fetch(`/api/chat/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      await refresh();
    } catch {
      // best-effort rename
    }
  }

  async function removeConversation(id: string) {
    setConfirmDeleteId(null);
    try {
      await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' });
      await refresh();
      if (activeId === id) router.push('/chat');
    } catch {
      // best-effort delete
    }
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-white/5 bg-black/30 backdrop-blur-xl">
      {/* Header */}
      <div className="border-b border-white/5 p-3">
        <button
          onClick={() => router.push('/chat')}
          className="flex w-full items-center gap-2 rounded-xl border border-[#22c55e]/30 bg-[#22c55e]/10 px-3 py-2 text-sm font-medium text-[#4ade80] transition-colors hover:bg-[#22c55e]/20"
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 focus-within:border-[#22c55e]/40">
          <Search className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-500 hover:text-white" aria-label="Clear search">
              <XMark className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading && conversations.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-gray-600">Loading conversations…</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-gray-600">
            {query ? 'No matches' : 'No conversations yet — start a new chat.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((conv) => {
              const active = conv.id === activeId;
              const editing = conv.id === editingId;
              return (
                <li key={conv.id} className="group relative">
                  <button
                    onClick={() => router.push(`/chat/${conv.id}`)}
                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                      active ? 'bg-[#22c55e]/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm ${active ? 'font-medium text-white' : 'text-gray-300'}`}>
                          {conv.title || 'New chat'}
                        </span>
                        <span className="shrink-0 text-[10px] text-gray-600">{timeAgo(conv.updated_at)}</span>
                      </span>
                      {conv.preview && (
                        <span className="mt-0.5 block truncate text-xs text-gray-600">{conv.preview}</span>
                      )}
                    </span>
                  </button>

                  {/* Hover actions */}
                  {!editing && (
                    <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => startRename(conv)}
                        className="rounded-md p-1 text-gray-500 hover:bg-white/10 hover:text-white"
                        aria-label={`Rename ${conv.title}`}
                      >
                        <SquarePen className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(confirmDeleteId === conv.id ? null : conv.id)}
                        className="rounded-md p-1 text-gray-500 hover:bg-red-500/20 hover:text-red-400"
                        aria-label={`Delete ${conv.title}`}
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}

                  {/* Inline rename */}
                  {editing && (
                    <div className="absolute inset-x-2 top-1 z-10 rounded-xl border border-[#22c55e]/40 bg-[#161616] p-1.5 shadow-xl">
                      <input
                        ref={editRef}
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        onBlur={() => void commitRename()}
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none"
                      />
                    </div>
                  )}

                  {/* Delete confirm */}
                  {confirmDeleteId === conv.id && (
                    <div className="absolute inset-x-2 top-1 z-10 rounded-xl border border-red-500/30 bg-[#161616] p-2 shadow-xl">
                      <p className="mb-2 text-xs text-gray-300">Delete this chat?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => void removeConversation(conv.id)}
                          className="rounded-lg bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-500/30"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-gray-300 hover:bg-white/10"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
