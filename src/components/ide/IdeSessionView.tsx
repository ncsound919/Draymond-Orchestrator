'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { IdeSession, IdeStep, IdeEvent, IdeDecision } from '@/lib/ide/types';

const PHASE_STYLES: Record<string, string> = {
  assembling: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  running: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  waiting_decision: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  paused: 'bg-slate-500/15 text-slate-300 border-slate-500/25',
  reviewing: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
  done: 'bg-green-500/15 text-green-300 border-green-500/25',
  error: 'bg-red-500/15 text-red-300 border-red-500/25',
};

const STEP_STATUS_ICON: Record<string, string> = {
  queued: '○',
  running: '●',
  waiting: '◷',
  done: '✓',
  failed: '✗',
};

const REFRESH_ON = new Set([
  'step.started',
  'step.completed',
  'step.failed',
  'review.verdict',
  'decision.required',
  'decision.escalated',
  'decision.resolved',
  'session.completed',
  'session.paused',
  'session.resumed',
]);

function formatEvent(e: IdeEvent): { icon: string; color: string; text: string } {
  const d = e.data as Record<string, unknown>;
  switch (e.type) {
    case 'session.created':
      return { icon: '◆', color: 'text-emerald-300', text: `Session created — ${String(d.goal ?? '')}` };
    case 'crew.assembled':
      return { icon: '👥', color: 'text-emerald-300', text: `Crew assembled — lead ${String((d.crew as { lead?: string })?.lead ?? '')}` };
    case 'session.started':
      return { icon: '▶', color: 'text-sky-300', text: 'Team started working' };
    case 'step.started':
      return { icon: '●', color: 'text-emerald-300', text: `${String((d.step as IdeStep)?.title ?? 'step')} (${String((d.step as IdeStep)?.agent ?? '')}/${String((d.step as IdeStep)?.kind ?? '')})` };
    case 'step.completed':
      return { icon: '✓', color: 'text-emerald-400', text: `${String((d.step as IdeStep)?.title ?? 'step')} done` };
    case 'step.failed':
      return { icon: '✗', color: 'text-red-400', text: `${String((d.step as IdeStep)?.title ?? 'step')} failed — ${String(d.error ?? '')}` };
    case 'file.changed':
      return { icon: '📄', color: 'text-gray-300', text: `${String((d.file as { action?: string })?.action ?? 'touched')} ${String((d.file as { path?: string })?.path ?? '')}` };
    case 'file.diff':
      return { icon: '⇄', color: 'text-cyan-300', text: `diff ${String((d.file as { path?: string })?.path ?? '')}` };
    case 'test.result':
      return { icon: '🧪', color: 'text-emerald-300', text: `${String((d.test as { name?: string })?.name ?? 'test')}: ${String((d.test as { status?: string })?.status ?? '')}` };
    case 'review.verdict':
      return {
        icon: '🔍',
        color: d.review && (d.review as { passed?: boolean }).passed ? 'text-emerald-300' : 'text-orange-300',
        text: `Review: ${String((d.review as { scorer?: string })?.scorer ?? '')} ${String((d.review as { score?: number | null })?.score ?? 'n/a')}/100 ${(d.review as { passed?: boolean })?.passed ? '(PASS)' : '(BELOW THRESHOLD)'}`,
      };
    case 'message':
      return { icon: '💬', color: 'text-gray-300', text: String(d.text ?? '') };
    case 'decision.required':
      return { icon: '⚠', color: 'text-orange-300', text: `Decision needed (${String(d.risk ?? '')}): ${String(d.prompt ?? '').slice(0, 120)}` };
    case 'decision.escalated':
      return { icon: '📲', color: 'text-amber-300', text: `Escalated via ${String(d.method ?? '')} — no answer yet` };
    case 'decision.resolved':
      return { icon: '✅', color: 'text-emerald-300', text: `Decision ${String(d.status ?? '')} (${String(d.method ?? '')})` };
    case 'session.paused':
      return { icon: '⏸', color: 'text-slate-300', text: 'Team paused' };
    case 'session.resumed':
      return { icon: '▶', color: 'text-emerald-300', text: 'Team resumed' };
    case 'session.completed':
      return { icon: '🏁', color: 'text-green-300', text: (d.aborted ? 'Session aborted' : 'Session complete') + (d.note ? ` — ${String(d.note)}` : '') };
    default:
      return { icon: '·', color: 'text-gray-500', text: e.type };
  }
}

export default function IdeSessionView({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<IdeSession | null>(null);
  const [events, setEvents] = useState<IdeEvent[]>([]);
  const [composer, setComposer] = useState('');
  const [redirect, setRedirect] = useState('');
  const [error, setError] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ide/sessions/${sessionId}`);
      if (!res.ok) {
        setSession(null);
        return;
      }
      const data = (await res.json()) as { session: IdeSession };
      setSession(data.session);
      setEvents(data.session.events);
    } catch {
      setSession(null);
    }
  }, [sessionId]);

  useEffect(() => {
    // Initial fetch on mount (async — setState lands after the awaited fetch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Live SSE stream.
  useEffect(() => {
    const es = new EventSource(`/api/ide/sessions/${sessionId}/stream`);
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as IdeEvent;
        // Dedupe by id — EventSource auto-reconnect replays persisted events.
        setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
        if (REFRESH_ON.has(event.type)) void load();
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; no action needed.
    };
    return () => es.close();
  }, [sessionId, load]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [events]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [session?.chat]);

  const interject = useCallback(
    async (action: 'pause' | 'resume' | 'message' | 'redirect' | 'abort', content?: string) => {
      setError('');
      try {
        const res = await fetch(`/api/ide/sessions/${sessionId}/interject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, content }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          setError(detail || `Interject failed (${res.status})`);
          return false;
        }
        const data = (await res.json()) as { session: IdeSession };
        setSession(data.session);
        void load();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [sessionId, load],
  );

  const sendMessage = useCallback(async () => {
    const text = composer.trim();
    if (!text) return;
    if (await interject('message', text)) setComposer('');
  }, [composer, interject]);

  const sendRedirect = useCallback(async () => {
    const text = redirect.trim();
    if (!text) return;
    if (await interject('redirect', text)) setRedirect('');
  }, [redirect, interject]);

  const resolveDecision = useCallback(
    async (decision: IdeDecision, approved: boolean, optionId?: string) => {
      try {
        await fetch(`/api/ide/sessions/${sessionId}/decisions/${decision.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approved, optionId }),
        });
        void load();
      } catch {
        // ignore
      }
    },
    [sessionId, load],
  );

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-500">Session not found or still loading…</p>
      </div>
    );
  }

  const runningStep = session.steps.find((s) => s.status === 'running');
  const pendingDecision = session.decisions.find((d) => d.status === 'pending');
  const crewStatus = (agent: string) => {
    if (session.phase === 'done') return 'idle';
    if (runningStep?.agent === agent) return 'working';
    return 'ready';
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {error && (
        <div className="relative z-20 border-b border-red-500/20 bg-red-500/10 px-4 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── Left: ChatGPT-style sidebar ─────────────────────────────── */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-white/5 bg-black/40">
          {/* Session header */}
          <div className="border-b border-white/5 p-4">
            <Link href="/ide" className="text-[11px] text-gray-500 hover:text-white">
              ← All sessions
            </Link>
            <div className="mt-2 flex items-start justify-between gap-2">
              <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-white">{session.goal}</h2>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${PHASE_STYLES[session.phase] ?? 'border-white/10 bg-white/5 text-gray-400'}`}>
                {session.phase.replace('_', ' ')}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              lead: {session.crew.lead} &middot; {session.steps.filter((s) => s.status === 'done').length}/{session.steps.length} steps
            </p>
            {/* Interject bar */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {session.phase === 'paused' ? (
                <button onClick={() => void interject('resume')} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20">
                  ▶ Resume
                </button>
              ) : (
                <button onClick={() => void interject('pause')} disabled={session.phase === 'done'} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-gray-300 hover:bg-white/10 disabled:opacity-30">
                  ⏸ Pause
                </button>
              )}
              <button onClick={() => { if (window.confirm('Abort this coding session?')) void interject('abort'); }} disabled={session.phase === 'done'} className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-30">
                ✕ Abort
              </button>
            </div>
          </div>

          {/* Team roster */}
          <div className="border-b border-white/5 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Team</p>
            <div className="mt-2 space-y-1.5">
              {[session.crew.lead, ...session.crew.members].map((member) => (
                <div key={member} className="flex items-center gap-2 text-xs">
                  <span className={`h-1.5 w-1.5 rounded-full ${crewStatus(member) === 'working' ? 'animate-pulse bg-emerald-400' : crewStatus(member) === 'ready' ? 'bg-emerald-600' : 'bg-slate-600'}`} />
                  <span className="text-gray-300">{member}</span>
                  {member === session.crew.lead && <span className="text-[9px] uppercase tracking-wider text-emerald-400">lead</span>}
                  {crewStatus(member) === 'working' && <span className="text-[10px] text-emerald-400">working…</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Chat */}
          <div ref={chatRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-3">
              {session.chat.map((m) => (
                <div key={m.id} className={`flex items-start gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <span className={`mt-1 h-6 w-6 shrink-0 rounded-full text-center text-[10px] leading-6 ${m.role === 'user' ? 'bg-white/10 text-gray-300' : 'bg-gradient-to-br from-emerald-500/80 to-green-600/60 text-black'}`}>
                    {m.role === 'user' ? 'U' : 'D'}
                  </span>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${m.role === 'user' ? 'rounded-br-sm bg-emerald-500/15 text-white' : m.role === 'system' ? 'rounded-bl-sm border border-amber-500/20 bg-amber-500/10 text-amber-200' : 'rounded-bl-sm border border-white/10 bg-white/[0.04] text-gray-200'}`}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Redirect input */}
          <div className="border-t border-white/5 p-3">
            <div className="flex items-center gap-1.5">
              <input
                value={redirect}
                onChange={(e) => setRedirect(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void sendRedirect(); }}
                placeholder="Redirect the team (next step)…"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-gray-600 focus:border-amber-500/40"
              />
              <button onClick={() => void sendRedirect()} className="rounded-lg bg-amber-500/15 px-2 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25" title="Set redirect">
                ↻
              </button>
            </div>
          </div>

          {/* Composer */}
          <div className="border-t border-white/5 p-3">
            <div className="flex items-end gap-1.5">
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
                placeholder="Message the team…"
                rows={1}
                className="max-h-24 flex-1 resize-none rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-gray-600 focus:border-emerald-500/40"
              />
              <button onClick={() => void sendMessage()} className="rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 px-2.5 py-1.5 text-xs font-semibold text-black hover:opacity-90">
                →
              </button>
            </div>
            <p className="mt-1 px-1 text-[9px] text-gray-600">Enter to send to the team &middot; Shift+Enter for a new line</p>
          </div>
        </aside>

        {/* ── Center: live work view ──────────────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto" ref={feedRef}>
            <div className="mx-auto w-full max-w-2xl space-y-5 px-6 py-6">
              {/* Steps */}
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Plan</h3>
                <div className="mt-2 space-y-2">
                  {session.steps.map((s) => (
                    <div key={s.id} className={`rounded-xl border p-3 ${s.status === 'failed' ? 'border-red-500/25 bg-red-500/[0.04]' : s.status === 'running' ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-white/10 bg-white/[0.03]'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${s.status === 'running' ? 'animate-pulse text-emerald-400' : s.status === 'failed' ? 'text-red-400' : s.status === 'done' ? 'text-emerald-500' : 'text-gray-600'}`}>
                          {STEP_STATUS_ICON[s.status]}
                        </span>
                        <span className="text-sm font-medium text-white">{s.index + 1}. {s.title}</span>
                        <span className="ml-auto shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] uppercase tracking-wider text-gray-400">
                          {s.agent}/{s.kind}
                        </span>
                      </div>
                      {s.detail && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-2 text-[11px] text-gray-400">{s.detail}</pre>}
                      {s.files && s.files.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {s.files.map((f, i) => (
                            <p key={i} className="text-[11px] text-gray-500">
                              <span className="text-emerald-400">{f.action}</span> {f.path}
                            </p>
                          ))}
                        </div>
                      )}
                      {s.tests && s.tests.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {s.tests.map((t, i) => (
                            <p key={i} className="text-[11px]">
                              <span className={t.status === 'pass' ? 'text-emerald-400' : t.status === 'error' ? 'text-red-400' : 'text-amber-300'}>
                                {t.status === 'pass' ? '✓' : t.status === 'error' ? '✗' : '◷'} {t.name}
                              </span>
                              {t.detail && <span className="ml-1 text-gray-600">{t.detail.slice(0, 200)}</span>}
                            </p>
                          ))}
                        </div>
                      )}
                      {s.error && <p className="mt-2 text-[11px] text-red-400">{s.error}</p>}
                    </div>
                  ))}
                </div>
              </section>

              {/* Activity feed */}
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Live activity</h3>
                <div className="mt-2 space-y-1.5">
                  {events.slice(-60).map((e, i) => {
                    const f = formatEvent(e);
                    return (
                      <div key={e.id ?? i} className="flex items-start gap-2 text-xs">
                        <span className={`w-5 shrink-0 text-center ${f.color}`}>{f.icon}</span>
                        <span className={`min-w-0 break-words ${f.color}`}>{f.text}</span>
                        <span className="ml-auto shrink-0 text-[9px] text-gray-700">{new Date(e.ts).toLocaleTimeString()}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </main>

        {/* ── Right: decisions + review + meta ────────────────────────── */}
        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/5 bg-black/30 p-4">
          {pendingDecision ? (
            <section className="rounded-xl border border-orange-500/30 bg-orange-500/[0.06] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-300">Decision required</p>
              <p className="mt-1 text-xs text-gray-200">{pendingDecision.prompt}</p>
              <p className="mt-1 text-[10px] text-gray-500">risk: {pendingDecision.risk}</p>
              <div className="mt-2 space-y-1.5">
                {pendingDecision.options.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => void resolveDecision(pendingDecision, true, o.id)}
                    className="block w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-left text-[11px] text-emerald-200 hover:bg-emerald-500/20"
                  >
                    <span className="font-semibold">{o.label}</span>
                    {o.description && <span className="block text-[10px] text-emerald-300/70">{o.description}</span>}
                  </button>
                ))}
              </div>
              <button onClick={() => void resolveDecision(pendingDecision, false)} className="mt-2 w-full rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/20">
                Reject
              </button>
            </section>
          ) : null}

          {session.review ? (
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Review gate</p>
              <p className={`mt-1 text-lg font-bold ${session.review.passed ? 'text-emerald-400' : 'text-orange-400'}`}>
                {session.review.score ?? 'n/a'} <span className="text-xs text-gray-500">/ {session.review.gateThreshold} · {session.review.scorer}</span>
              </p>
              <p className="mt-1 text-[11px] text-gray-400">{session.review.summary}</p>
              {session.review.grade && <p className="mt-1 text-[11px] text-gray-500">grade: {session.review.grade}</p>}
              {session.review.detail && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-2 text-[10px] text-gray-500">{session.review.detail}</pre>}
            </section>
          ) : null}

          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Session</p>
            <dl className="mt-2 space-y-1.5 text-[11px] text-gray-400">
              <div className="flex justify-between"><dt>ID</dt><dd className="font-mono text-gray-500">{session.id.slice(0, 8)}…</dd></div>
              <div className="flex justify-between"><dt>Created</dt><dd>{new Date(session.createdAt).toLocaleString()}</dd></div>
              {session.workspace && <div className="flex justify-between"><dt>Workspace</dt><dd className="max-w-[180px] truncate">{session.workspace}</dd></div>}
              {session.repoUrl && <div className="flex justify-between"><dt>Repo</dt><dd className="max-w-[180px] truncate">{session.repoUrl}</dd></div>}
              {session.note && <div className="flex justify-between"><dt>Note</dt><dd className="max-w-[180px] break-words">{session.note}</dd></div>}
            </dl>
            <p className="mt-3 text-[10px] text-gray-600">{session.crew.reason}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
