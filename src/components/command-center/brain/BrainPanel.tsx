'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ccFetch } from '@/app/command-center/actions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  brainHealth,
  relativeTime,
  type BrainAgendaItem,
  type BrainDecisionResult,
  type BrainPayload,
} from '../fleet-lib';
import {
  findingCounts,
  findingStatusColor,
  formatCoverage,
  isFullCoverage,
  severityColor,
  sortFindings,
  sweepModeLabel,
  type CoverageLike,
  type FindingLike,
} from '../brain-lib';

const BRAIN_BADGE = {
  online: 'bg-green-500/20 text-green-400',
  degraded: 'bg-yellow-500/20 text-yellow-400',
  offline: 'bg-red-500/20 text-red-400',
} as const;

const BRAIN_DOT = {
  online: 'bg-green-400',
  degraded: 'bg-yellow-400',
  offline: 'bg-red-400',
} as const;

interface SweepResponse {
  ok?: boolean;
  report?: { run_id?: string; findings?: FindingLike[]; latency_ms?: number };
  error?: string;
}
interface TaskResponse {
  ok?: boolean;
  output?: string;
  error?: string;
}
interface FallbackResponse {
  coverage?: CoverageLike;
  degraded?: boolean;
}

export default function BrainPanel() {
  const queryClient = useQueryClient();

  const [sweepMode, setSweepMode] = useState('manual');
  const [sweepScope, setSweepScope] = useState('all');
  const [maxFindings, setMaxFindings] = useState(20);
  const [taskQuery, setTaskQuery] = useState('');
  const [taskLane, setTaskLane] = useState('');

  // ── Status / agenda ──────────────────────────────────────────────────
  const brainQuery = useQuery({
    queryKey: ['command-center', 'ops-brain'],
    queryFn: async () => {
      const res = await ccFetch<BrainPayload>({ endpoint: '/api/ops/brain', method: 'GET' });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
  });

  // ── Fallback coverage (brain = Draymond's fallback) ───────────────────
  const fallbackQuery = useQuery({
    queryKey: ['command-center', 'ops-brain-fallback'],
    queryFn: async () => {
      const res = await ccFetch<FallbackResponse>({
        endpoint: '/api/ops/brain/fallback',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data?.coverage ?? null;
    },
    refetchInterval: 30_000,
  });

  // ── Sweep ─────────────────────────────────────────────────────────────
  const runSweep = useMutation({
    mutationFn: async () => {
      const res = await ccFetch<SweepResponse>({
        endpoint: '/api/ops/brain/sweep',
        method: 'POST',
        body: { mode: sweepMode, scope: sweepScope, maxFindings },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (data) => {
      const n = data?.report?.findings?.length ?? 0;
      toast.success(`Sweep complete — ${n} finding(s)`);
    },
    onError: (err) =>
      toast.error(`Sweep failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  // ── Task send ─────────────────────────────────────────────────────────
  const runTask = useMutation({
    mutationFn: async () => {
      const res = await ccFetch<TaskResponse>({
        endpoint: '/api/ops/brain/task',
        method: 'POST',
        body: { query: taskQuery, lane: taskLane || undefined },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (data) => {
      const out = data?.output?.trim() ?? '';
      toast.success(out ? `Brain: ${out.slice(0, 120)}` : 'Brain task done');
      setTaskQuery('');
    },
    onError: (err) =>
      toast.error(`Brain task failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  // ── Decision cycle (existing) ─────────────────────────────────────────
  const runCycle = useMutation({
    mutationFn: async () => {
      const res = await ccFetch<BrainDecisionResult>({ endpoint: '/api/ops/brain', method: 'POST', body: {} });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`Decision cycle complete — ${data?.actions?.length ?? 0} action(s)`);
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'ops-brain'] });
    },
    onError: (err) =>
      toast.error(`Decision cycle failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  // ── Degraded toggle ───────────────────────────────────────────────────
  const setDegraded = useMutation({
    mutationFn: async (degraded: boolean) => {
      const res = await ccFetch<FallbackResponse>({
        endpoint: '/api/ops/brain/fallback',
        method: 'POST',
        body: { degraded },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Fallback mode updated');
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'ops-brain-fallback'] });
    },
    onError: (err) =>
      toast.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  const brain = brainQuery.data?.brain ?? null;
  const health = brainHealth(brain);
  const agenda = brainQuery.data?.agenda ?? [];
  const coverage = fallbackQuery.data;
  const findings = runSweep.data?.report?.findings ?? [];
  const sortedFindings = sortFindings(findings, 50);
  const { open, total } = findingCounts(sortedFindings);

  return (
    <div className="space-y-6">
      {/* ── Fallback banner (brain is Draymond's fallback) ────────────── */}
      <section>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">Fallback coverage</h2>
              <p className="text-xs text-white/40">
                The deterministic brain is Draymond&apos;s fallback when the LLM chain degrades.
              </p>
            </div>
            {fallbackQuery.isLoading ? (
              <Skeleton className="h-6 w-40 bg-white/10" />
            ) : fallbackQuery.isError ? (
              <span className="text-xs text-red-300">Coverage unavailable</span>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    isFullCoverage(coverage)
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-yellow-500/20 text-yellow-400'
                  }`}
                >
                  {formatCoverage(coverage)}
                </span>
                <span className="text-xs text-white/40">
                  {coverage?.uncovered?.length ? `${coverage.uncovered.length} uncovered` : 'all covered'}
                </span>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3 border-t border-white/10 pt-3">
            <span className="text-xs text-white/40">Degraded mode</span>
            <Switch
              checked={coverage?.degraded === true}
              disabled={setDegraded.isPending}
              onCheckedChange={(checked) => setDegraded.mutate(checked)}
            />
            <span className="text-xs text-white/40">
              {coverage?.degraded ? 'fallback active' : 'LLM chain active'}
            </span>
          </div>
        </div>
      </section>

      {/* ── Brain status + decision cycle ─────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Brain Status</h2>
        {brainQuery.isLoading ? (
          <Skeleton className="h-32 w-full bg-white/10" />
        ) : brainQuery.isError ? (
          <OfflineCard message={brainQuery.error.message} onRetry={() => void brainQuery.refetch()} />
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${BRAIN_DOT[health]}`} />
                  <span className="text-sm font-semibold capitalize text-white">{health}</span>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BRAIN_BADGE[health]}`}>
                    {health}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                  <div className="text-xs text-white/40">
                    Last run
                    <dd className="mt-0.5 text-white/70">{brain?.last_run_at ? relativeTime(brain.last_run_at) : 'Never'}</dd>
                  </div>
                  <div className="text-xs text-white/40">
                    Findings
                    <dd className="mt-0.5 text-white/70">{brain?.total_findings ?? '—'}</dd>
                  </div>
                  <div className="text-xs text-white/40">
                    Open findings
                    <dd className="mt-0.5 text-white/70">{brain?.open_findings ?? '—'}</dd>
                  </div>
                  <div className="text-xs text-white/40">
                    Communities
                    <dd className="mt-0.5 text-white/70">{Array.isArray(brain?.communities) ? brain.communities.length : '—'}</dd>
                  </div>
                </dl>
              </div>
              <Button
                variant="outline"
                disabled={runCycle.isPending}
                className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                onClick={() => runCycle.mutate()}
              >
                {runCycle.isPending ? 'Running…' : 'Run decision cycle'}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ── Sweep controls ────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Brain Sweep</h2>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wider text-white/40">Mode</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {['manual', 'auto', 'daily', 'weekly'].map((m) => (
                  <button
                    key={m}
                    onClick={() => setSweepMode(m)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      sweepMode === m ? 'bg-white/15 text-white' : 'bg-white/5 text-white/40 hover:text-white'
                    }`}
                  >
                    {sweepModeLabel(m)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-white/40">Scope</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {['all', 'community'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSweepScope(s)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      sweepScope === s ? 'bg-white/15 text-white' : 'bg-white/5 text-white/40 hover:text-white'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/70">Max findings</span>
              <span className="font-mono text-xs text-white/60">{maxFindings}</span>
            </div>
            <Slider
              value={maxFindings}
              min={5}
              max={100}
              step={5}
              onValueChange={(v) => setMaxFindings(Number(v))}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={runSweep.isPending}
            className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            onClick={() => runSweep.mutate()}
          >
            {runSweep.isPending ? 'Sweeping…' : 'Run sweep'}
          </Button>
          {runSweep.data?.report ? (
            <p className="text-xs text-white/40">
              Sweep {runSweep.data.report.run_id ?? ''} · {total} finding(s), {open} open
            </p>
          ) : null}
        </div>
      </section>

      {/* ── Findings ──────────────────────────────────────────────────── */}
      {findings.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">Findings</h2>
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
            {sortedFindings.map((f, i) => (
              <div key={f.node_id ?? i} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${severityColor(f.severity)}`}>
                    {f.severity ?? 'info'}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${findingStatusColor(f.status)}`}>
                    {f.status ?? 'open'}
                  </span>
                  <span className="text-xs text-white/40">
                    {f.confidence != null ? `${Math.round(f.confidence * 100)}%` : ''}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-white">{f.proposed_change ?? f.node_id ?? 'finding'}</p>
                <p className="truncate text-xs text-white/40">
                  {f.node_id ?? ''}
                  {f.component_class ? ` · ${f.component_class}` : ''}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Brain task send ───────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Send Brain Task</h2>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <textarea
            value={taskQuery}
            onChange={(e) => setTaskQuery(e.target.value)}
            placeholder="Ask the deterministic brain to finish a task (paper intent → auto research publish)"
            rows={2}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
          />
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={taskLane}
              onChange={(e) => setTaskLane(e.target.value)}
              placeholder="lane (optional)"
              className="w-48 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={runTask.isPending || !taskQuery.trim()}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              onClick={() => runTask.mutate()}
            >
              {runTask.isPending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
      </section>

      {/* ── Agenda ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Agenda</h2>
        {brainQuery.isLoading ? (
          <Skeleton className="h-24 w-full bg-white/10" />
        ) : brainQuery.isError ? null : agenda.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">No agenda items.</div>
        ) : (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
            {agenda.map((item: BrainAgendaItem, index) => (
              <div key={`${item.title ?? index}`} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-white">{item.title ?? 'Untitled'}</span>
                  {item.status ? <span className="text-xs uppercase text-white/40">{item.status}</span> : null}
                </div>
                {typeof item.progress === 'number' ? (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-green-500" style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OfflineCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
      <p className="text-sm font-medium text-red-300">Brain unavailable</p>
      <p className="mt-1 text-xs text-red-300/70">{message}</p>
      <Button size="sm" variant="outline" className="mt-2 border-red-500/30 text-red-300 hover:bg-red-500/10 hover:text-red-200" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
