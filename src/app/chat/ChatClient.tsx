'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  error?: boolean;
};

const STORAGE_KEY = 'draymond.chat.history';

// ── Minimal inline icons (no icon dependency in this app) ───────────────────

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'h-4 w-4'}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const Icons = {
  send: () => (
    <Icon className="h-4 w-4">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </Icon>
  ),
  plus: () => (
    <Icon className="h-3.5 w-3.5">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  ),
  sparkles: () => (
    <Icon>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </Icon>
  ),
  activity: () => (
    <Icon>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </Icon>
  ),
  checkSquare: () => (
    <Icon>
      <path d="m9 11 3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </Icon>
  ),
  gitBranch: () => (
    <Icon>
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </Icon>
  ),
  heartPulse: () => (
    <Icon>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
    </Icon>
  ),
  headset: () => (
    <Icon>
      <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm18 0h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-5Z" />
      <path d="M21 11v2a9 9 0 0 1-9 9h-2" />
    </Icon>
  ),
  user: () => (
    <Icon className="h-3.5 w-3.5">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  ),
  trash: () => (
    <Icon className="h-3.5 w-3.5">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Icon>
  ),
};

// ── Suggestions ─────────────────────────────────────────────────────────────

type Suggestion = {
  icon: ReactNode;
  label: string;
  hint: string;
  task: string;
};

const SUGGESTIONS: Suggestion[] = [
  { icon: <Icons.activity />, label: 'System status', hint: 'Overview & health', task: 'Show me the current system status' },
  { icon: <Icons.checkSquare />, label: 'Pending approvals', hint: 'Awaiting review', task: 'What actions are pending approval?' },
  { icon: <Icons.gitBranch />, label: 'Research Pipeline', hint: 'Run a chain', task: 'Run the Research Pipeline chain' },
  { icon: <Icons.heartPulse />, label: 'Agent health', hint: 'Fleet check-up', task: 'Check the health of all agents' },
  { icon: <Icons.headset />, label: 'AetherDesk', hint: 'Call center ops', task: 'List the AetherDesk agents' },
  { icon: <Icons.sparkles />, label: 'General task', hint: 'Ask anything', task: 'Draft a plan for launching a new feature' },
];

// ── Storage helpers ──────────────────────────────────────────────────────────

function loadHistory(): Message[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Message[];
    return Array.isArray(parsed) ? parsed.filter((m) => m && m.content) : [];
  } catch {
    return [];
  }
}

function saveHistory(messages: Message[]): void {
  try {
    const trimmed = messages.slice(-100).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // storage unavailable — ignore
  }
}

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatUserPrompt(messages: Message[]): Message[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ id: m.id, role: m.role, content: m.content }));
}

// ── Route announcement → sleek pill ──────────────────────────────────────────

const ROUTE_PILL_RE = /^\n?\[([a-z_]+) → ([^\]]+)\] \((\d+)%\)\n\n([\s\S]*)$/;

function renderAssistantContent(content: string) {
  const match = content.match(ROUTE_PILL_RE);
  if (!match) {
    return <p className="whitespace-pre-wrap break-words">{content}</p>;
  }

  const [, intent, target, confidence, rest] = match;
  return (
    <div className="space-y-2.5">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22c55e]/25 bg-[#22c55e]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#4ade80]">
        <Icons.gitBranch />
        {intent.replace(/_/g, ' ')} &rarr; {target}
        <span className="rounded-full bg-[#22c55e]/20 px-1.5 py-px font-mono text-[9px]">
          {confidence}%
        </span>
      </span>
      <p className="whitespace-pre-wrap break-words">{rest}</p>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ChatClient({ userEmail }: { userEmail?: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const stored = loadHistory();
    setMessages(stored);
  }, []);

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Auto-resize the composer as the user types.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const appendAssistantChunk = useCallback((assistantId: string, chunk: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, content: m.content + chunk, pending: true } : m,
      ),
    );
  }, []);

  const finalizeAssistant = useCallback(
    (assistantId: string, opts?: { error?: boolean }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, pending: false, error: opts?.error ?? m.error }
            : m,
        ),
      );
    },
    [],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;

      const userMsg: Message = { id: makeId(), role: 'user', content: text };
      const assistantMsg: Message = {
        id: makeId(),
        role: 'assistant',
        content: '',
        pending: true,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput('');
      setSending(true);

      const history = formatUserPrompt(messages);
      const payload = { messages: [...history, { role: 'user', content: text }] };

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
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
          appendAssistantChunk(assistantMsg.id, msg);
          finalizeAssistant(assistantMsg.id, { error: true });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Read the SSE stream incrementally until the response closes.
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

              let parsed: { type?: string; content?: string; error?: string } | null = null;
              try {
                parsed = JSON.parse(data) as { type?: string; content?: string; error?: string };
              } catch {
                continue;
              }

              if (parsed?.type === 'text' && typeof parsed.content === 'string') {
                appendAssistantChunk(assistantMsg.id, parsed.content);
              } else if (parsed?.type === 'error') {
                appendAssistantChunk(
                  assistantMsg.id,
                  parsed.error ?? 'An unexpected error occurred.',
                );
              }
            }
          }
        }

        finalizeAssistant(assistantMsg.id);
      } catch (err) {
        appendAssistantChunk(
          assistantMsg.id,
          `Network error: ${err instanceof Error ? err.message : String(err)}`,
        );
        finalizeAssistant(assistantMsg.id, { error: true });
      } finally {
        setSending(false);
        inputRef.current?.focus();
      }
    },
    [appendAssistantChunk, finalizeAssistant, messages, sending],
  );

  const newChat = useCallback(() => {
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            'radial-gradient(ellipse 60% 100% at 50% -10%, rgba(34,197,94,0.10), transparent 70%)',
        }}
        aria-hidden="true"
      />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="relative z-10 border-b border-white/5 bg-black/40 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="animate-chat-orb relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#22c55e] to-[#16a34a] text-sm font-bold text-black">
              D
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight text-white">
                Draymond Assistant
              </p>
              <p className="flex items-center gap-1.5 text-[11px] leading-tight text-gray-500">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                Online &middot; routes to the right tool
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={newChat}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
              >
                <Icons.plus />
                New chat
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Messages ───────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="relative z-0 flex-1 min-h-0 overflow-y-auto">
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
                Ask for status, run an entity or chain, or describe any task. Draymond
                routes it to the right tool automatically &mdash; no crons or workflows
                required.
              </p>
              <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => void send(s.task)}
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
              <div
                key={m.id}
                className={`animate-chat-fade-up flex items-start gap-3 ${
                  m.role === 'user' ? 'flex-row-reverse' : ''
                }`}
              >
                {/* Avatar */}
                {m.role === 'assistant' ? (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#22c55e]/80 to-[#16a34a]/60 text-xs font-bold text-black shadow-lg shadow-[#22c55e]/10">
                    D
                  </div>
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-gray-400">
                    <Icons.user />
                  </div>
                )}

                {/* Bubble */}
                <div
                  className={`max-w-[82%] text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'rounded-2xl rounded-br-md border border-[#22c55e]/20 bg-gradient-to-br from-[#22c55e]/25 to-[#22c55e]/10 px-4 py-2.5 text-white shadow-lg shadow-[#22c55e]/5'
                      : m.error
                        ? 'rounded-2xl rounded-bl-md border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-red-300'
                        : 'rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-4 py-2.5 text-gray-200 backdrop-blur-sm'
                  }`}
                >
                  {m.pending && !m.content ? (
                    <span className="flex items-center gap-2 py-1">
                      <span className="text-xs text-gray-500">Draymond is working</span>
                      <span className="flex gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80] animate-bounce" />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-[#4ade80] animate-bounce"
                          style={{ animationDelay: '150ms' }}
                        />
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-[#4ade80] animate-bounce"
                          style={{ animationDelay: '300ms' }}
                        />
                      </span>
                    </span>
                  ) : m.role === 'assistant' ? (
                    renderAssistantContent(m.content)
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Composer ───────────────────────────────────────────────────── */}
      <div className="relative z-10 border-t border-white/5 bg-black/40 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">
          <div
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 transition-all duration-200 focus-within:border-[#22c55e]/40 focus-within:bg-white/[0.06] focus-within:shadow-[0_0_0_3px_rgba(34,197,94,0.08)]"
          >
            <div className="flex items-end gap-1.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder="Describe a task, ask for status, or name an entity or chain…"
                rows={1}
                disabled={sending}
                className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 disabled:opacity-50"
              />
              <button
                onClick={() => void send(input)}
                disabled={sending || !input.trim()}
                aria-label="Send message"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#22c55e] to-[#16a34a] text-black transition-all hover:shadow-lg hover:shadow-[#22c55e]/25 active:scale-95 disabled:opacity-30 disabled:hover:shadow-none"
              >
                {sending ? (
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
                  <Icons.send />
                )}
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between px-1">
            <p className="text-[10px] text-gray-600">
              Enter to send &middot; Shift+Enter for a new line
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
