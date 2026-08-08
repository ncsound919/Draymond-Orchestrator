'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { IdeSession } from '@/lib/ide/types';

type BenchRow = {
  tool: string;
  task: string;
  success: boolean;
  duration_ms: number;
  score?: number | null;
  files?: number;
  error?: string;
};

const PHASE_STYLES: Record<string, string> = {
  assembling: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  running: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  waiting_decision: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  paused: 'bg-slate-500/15 text-slate-300 border-slate-500/25',
  reviewing: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
  done: 'bg-green-500/15 text-green-300 border-green-500/25',
  error: 'bg-red-500/15 text-red-300 border-red-500/25',
};

export default function IdeList() {
  const router = useRouter();
  const [sessions, setSessions] = useState<IdeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [goal, setGoal] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [bench, setBench] = useState<{ running: boolean; rows: BenchRow[] }>({ running: false, rows: [] });
  const [benchError, setBenchError] = useState('');

  const loadBench = useCallback(async () => {
    try {
      const res = await fetch('/api/ide/benchmark');
      if (!res.ok) return;
      const data = (await res.json()) as { latest?: { results?: BenchRow[] } };
      const latest = data.latest;
      const rows = latest?.results;
      if (rows) setBench((b) => ({ ...b, rows }));
    } catch {
      // no baseline yet
    }
  }, []);

  const runBenchmark = useCallback(async () => {
    setBench((b) => ({ ...b, running: true }));
    setBenchError('');
    try {
      const res = await fetch('/api/ide/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setBenchError(`Benchmark failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { run?: { results?: BenchRow[] } };
      if (data.run?.results) setBench({ running: false, rows: data.run.results });
    } catch (err) {
      setBenchError(err instanceof Error ? err.message : String(err));
    } finally {
      setBench((b) => ({ ...b, running: false }));
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ide/sessions');
      if (!res.ok) throw new Error('failed to load');
      const data = (await res.json()) as { sessions: IdeSession[] };
      setSessions(data.sessions ?? []);
    } catch {
      // leave empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadBench();
  }, [load, loadBench]);

  const create = useCallback(async () => {
    const text = goal.trim();
    if (!text || creating) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/ide/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: text,
          workspace: workspace.trim() || undefined,
          repoUrl: repoUrl.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        setError(detail || `Request failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { session: IdeSession };
      router.push(`/ide/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [goal, workspace, repoUrl, creating, router]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            'radial-gradient(ellipse 60% 100% at 50% -10%, rgba(34,197,94,0.10), transparent 70%)',
        }}
        aria-hidden="true"
      />

      <header className="relative z-10 border-b border-white/5 bg-black/40 px-6 py-4 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">Agent IDE</h1>
            <p className="text-xs text-gray-500">
              Deploy the coding team, watch them work live, interject when needed.
            </p>
          </div>
          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
            {sessions.length} sessions
          </span>
        </div>
      </header>

      <div className="relative z-0 flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-6">
          {/* Create card */}
          <section className="glass-card rounded-2xl p-4">
            <p className="mb-2 text-sm font-semibold text-white">Start a coding session</p>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void create();
                }
              }}
              placeholder='e.g. "Fix the timeout bug in the scheduler job", "Refactor the repo scoring pipeline", "Add a /health endpoint to the payouts service"'
              rows={3}
              className="max-h-40 w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-emerald-500/40"
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                placeholder="Workspace path (optional)"
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-emerald-500/40"
              />
              <input
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="GitHub repo URL (optional, enables RepoRank/Grader)"
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-emerald-500/40"
              />
            </div>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[10px] text-gray-600">
                Enter to launch &middot; team auto-assembles from the master coding stack
              </p>
              <button
                onClick={() => void create()}
                disabled={creating || !goal.trim()}
                className="rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 px-4 py-2 text-sm font-semibold text-black transition-all hover:shadow-lg hover:shadow-emerald-500/25 active:scale-95 disabled:opacity-30"
              >
                {creating ? 'Dispatching…' : 'Launch coding team'}
              </button>
            </div>
          </section>

          {/* Benchmark card */}
          <section className="glass-card rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">IDE benchmark baseline</p>
                <p className="text-xs text-gray-500">
                  Exercises each tool with a standard task; results feed self-learning + the repair team.
                </p>
              </div>
              <button
                onClick={() => void runBenchmark()}
                disabled={bench.running}
                className="rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:shadow-lg hover:shadow-sky-500/25 active:scale-95 disabled:opacity-30"
              >
                {bench.running ? 'Running…' : 'Run benchmark'}
              </button>
            </div>
            {benchError && <p className="mt-2 text-xs text-red-400">{benchError}</p>}
            {bench.rows.length > 0 && (
              <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 border-b border-white/10 bg-black/50 text-gray-400">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">tool</th>
                      <th className="px-3 py-1.5 font-medium">task</th>
                      <th className="px-3 py-1.5 text-right font-medium">ms</th>
                      <th className="px-3 py-1.5 text-right font-medium">score</th>
                      <th className="px-3 py-1.5 text-right font-medium">files</th>
                      <th className="px-3 py-1.5 font-medium">status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bench.rows.map((r, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="px-3 py-1.5 text-gray-300">{r.tool}</td>
                        <td className="px-3 py-1.5 text-gray-500">{r.task}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400">{r.duration_ms}</td>
                        <td className="px-3 py-1.5 text-right text-gray-300">{r.score ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400">{r.files ?? '—'}</td>
                        <td className={`px-3 py-1.5 ${r.success ? 'text-emerald-400' : 'text-red-400'}`}>
                          {r.success ? 'ok' : r.error ?? 'failed'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Session list */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Recent sessions</h2>
            {loading && <p className="text-xs text-gray-500">Loading sessions…</p>}
            {!loading && sessions.length === 0 && (
              <p className="text-sm text-gray-600">No sessions yet. Launch one above, or ask in the chat screen.</p>
            )}
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={`/ide/${s.id}`}
                className="glass-card block rounded-xl p-4 transition-colors hover:border-white/20"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-white">{s.goal}</p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${PHASE_STYLES[s.phase] ?? 'border-white/10 bg-white/5 text-gray-400'}`}>
                    {s.phase.replace('_', ' ')}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                  <span>lead: {s.crew.lead}</span>
                  <span>&middot;</span>
                  <span>{s.steps.length} steps</span>
                  <span>&middot;</span>
                  <span>{s.steps.filter((x) => x.status === 'done').length} done</span>
                  {s.review?.score != null && (
                    <>
                      <span>&middot;</span>
                      <span className={s.review.passed ? 'text-emerald-400' : 'text-orange-400'}>
                        review {s.review.score}/{s.review.gateThreshold} ({s.review.scorer})
                      </span>
                    </>
                  )}
                  <span className="ml-auto">
                    {new Date(s.updatedAt).toLocaleString()}
                  </span>
                </div>
              </Link>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
