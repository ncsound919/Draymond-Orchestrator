'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export interface UltraplanPlanProps {
  id: string;
  status: string;
  task: { title: string; brief: string; scope?: string };
  createdAt: string;
  plan?: {
    goals?: string[];
    changes?: Array<{ file: string; description: string; line?: string }>;
    verification?: string[];
    tokenEstimate?: number;
  };
  error?: string;
}

const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-gray-500/20 text-gray-300',
  planning: 'bg-blue-500/20 text-blue-400',
  plan_ready: 'bg-amber-500/20 text-amber-400',
  approved: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
  failed: 'bg-red-500/20 text-red-400',
};

export default function UltraplanQueue({ plans }: { plans: UltraplanPlanProps[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function act(action: string, id: string, extra?: Record<string, unknown>) {
    setBusy(`${action}:${id}`);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/cognition/ultraplan/${id}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(extra ?? {}),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? `${action} failed`);
        }
      } catch {
        setError(`${action} failed`);
      } finally {
        setBusy(null);
        router.refresh();
      }
    });
  }

  function enqueue() {
    if (!title.trim() || !brief.trim()) {
      setError('title and brief are required');
      return;
    }
    setBusy('enqueue');
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/cognition/ultraplan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, brief, scope: scope.trim() || undefined }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? 'enqueue failed');
        } else {
          setTitle('');
          setBrief('');
          setScope('');
        }
      } catch {
        setError('enqueue failed');
      } finally {
        setBusy(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Enqueue form */}
      <div className="rounded-xl border border-white/[0.06] bg-gray-900/60 p-4 space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. Add Stripe billing)"
          className="w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-emerald-500/50 focus:outline-none"
        />
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Brief — what should the deep-planning pass produce?"
          rows={2}
          className="w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-emerald-500/50 focus:outline-none"
        />
        <input
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          placeholder="Scope (optional)"
          className="w-full rounded-lg border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-emerald-500/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={enqueue}
          disabled={isPending}
          className="rounded-lg border border-emerald-500/30 px-4 py-2 text-sm text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
        >
          {busy === 'enqueue' ? '…' : 'Enqueue deep plan'}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {/* Queue */}
      {plans.length === 0 ? (
        <p className="text-sm text-gray-500">No ultraplans yet. Enqueue a deep-planning task above.</p>
      ) : (
        <ul className="space-y-3">
          {plans.map((p) => (
            <li key={p.id} className="rounded-xl border border-white/[0.06] bg-gray-900/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{p.task.title}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] ?? 'bg-gray-500/20 text-gray-300'}`}>
                      {p.status}
                    </span>
                    <span className="text-[11px] text-gray-500 font-mono">{new Date(p.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{p.task.brief}</p>
                  {p.error && <p className="mt-1 text-xs text-red-400">{p.error}</p>}
                  {p.status === 'plan_ready' && p.plan && (
                    <div className="mt-3 space-y-2">
                      {p.plan.goals && p.plan.goals.length > 0 && (
                        <div>
                          <div className="text-[11px] text-gray-500 uppercase tracking-wider">Goals</div>
                          <ul className="mt-0.5 space-y-0.5">
                            {p.plan.goals.map((g, i) => <li key={i} className="text-xs text-gray-300">· {g}</li>)}
                          </ul>
                        </div>
                      )}
                      {p.plan.changes && p.plan.changes.length > 0 && (
                        <div>
                          <div className="text-[11px] text-gray-500 uppercase tracking-wider">Changes</div>
                          <ul className="mt-0.5 space-y-0.5">
                            {p.plan.changes.map((c, i) => (
                              <li key={i} className="text-xs text-gray-300 font-mono">
                                {c.file}{c.line ? `:${c.line}` : ''} — {c.description}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => act('approve', p.id)}
                          disabled={isPending}
                          className="rounded-lg border border-emerald-500/30 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => act('reject', p.id)}
                          disabled={isPending}
                          className="rounded-lg border border-red-500/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => act('process', p.id)}
                          disabled={isPending}
                          className="rounded-lg border border-blue-500/30 px-2.5 py-1 text-xs text-blue-400 hover:bg-blue-500/10 disabled:opacity-50"
                        >
                          Process
                        </button>
                        {['rejected', 'failed'].includes(p.status) && (
                          <button
                            type="button"
                            onClick={() => {
                              const brief = window.prompt('New brief for re-planning', p.task.brief);
                              if (brief && brief.trim()) act('replan', p.id, { brief });
                            }}
                            disabled={isPending}
                            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 hover:bg-white/5 disabled:opacity-50"
                          >
                            Re-plan
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
