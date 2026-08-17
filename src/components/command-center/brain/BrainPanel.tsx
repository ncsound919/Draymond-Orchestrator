'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ccFetch } from '@/app/command-center/actions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  brainHealth,
  relativeTime,
  type BrainAgendaItem,
  type BrainDecisionResult,
  type BrainPayload,
} from '../fleet-lib';

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

export default function BrainPanel() {
  const queryClient = useQueryClient();

  const brainQuery = useQuery({
    queryKey: ['command-center', 'ops-brain'],
    queryFn: async () => {
      const res = await ccFetch<BrainPayload>({
        endpoint: '/api/ops/brain',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
  });

  const runCycle = useMutation({
    mutationFn: async () => {
      const res = await ccFetch<BrainDecisionResult>({
        endpoint: '/api/ops/brain',
        method: 'POST',
        body: {},
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (data) => {
      const actions = data?.actions?.length ?? 0;
      const priorities = data?.priorities?.length ?? 0;
      toast.success(
        `Decision cycle complete — ${actions} action(s), ${priorities} priorit(ies)`,
      );
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'ops-brain'] });
    },
    onError: (err) => {
      toast.error(
        `Decision cycle failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  const brain = brainQuery.data?.brain ?? null;
  const health = brainHealth(brain);
  const agenda = brainQuery.data?.agenda ?? [];

  const degradedMode = brain?.degraded_mode;
  const fallbackCoverage = brain?.fallback_coverage;

  return (
    <div className="space-y-6">
      {/* ── Status + run cycle ─────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Brain Status</h2>
        {brainQuery.isLoading ? (
          <Skeleton className="h-32 w-full bg-white/10" />
        ) : brainQuery.isError ? (
          <OfflineCard
            message={brainQuery.error.message}
            onRetry={() => void brainQuery.refetch()}
          />
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${BRAIN_DOT[health]}`} />
                  <span className="text-sm font-semibold capitalize text-white">{health}</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BRAIN_BADGE[health]}`}
                  >
                    {health}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                  <div className="text-xs text-white/40">
                    Last run
                    <dd className="mt-0.5 text-white/70">
                      {brain?.last_run_at ? relativeTime(brain.last_run_at) : 'Never'}
                    </dd>
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
                    <dd className="mt-0.5 text-white/70">
                      {Array.isArray(brain?.communities) ? brain.communities.length : '—'}
                    </dd>
                  </div>
                </dl>
                {/* Defensive: degraded-mode / fallback-coverage indicators only when present. */}
                {(degradedMode !== undefined || fallbackCoverage !== undefined) && (
                  <div className="pt-2">
                    {degradedMode !== undefined && (
                      <div className="text-xs">
                        <span className="text-white/40">Mode:</span>{' '}
                        <span
                          className={
                            degradedMode
                              ? 'font-medium text-yellow-400'
                              : 'font-medium text-green-400'
                          }
                        >
                          {degradedMode ? 'degraded' : 'normal'}
                        </span>
                      </div>
                    )}
                    {fallbackCoverage !== undefined && (
                      <div className="text-xs">
                        <span className="text-white/40">Fallback coverage:</span>{' '}
                        <span className="font-medium text-white/70">
                          {typeof fallbackCoverage === 'number'
                            ? `${Math.round(fallbackCoverage * 100)}%`
                            : String(fallbackCoverage)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
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

      {/* ── Agenda ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Agenda</h2>
        {brainQuery.isLoading ? (
          <Skeleton className="h-24 w-full bg-white/10" />
        ) : brainQuery.isError ? null : agenda.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            No agenda items.
          </div>
        ) : (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
            {agenda.map((item: BrainAgendaItem, index) => (
              <div key={`${item.title ?? index}`} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-white">{item.title ?? 'Untitled'}</span>
                  {item.status ? (
                    <span className="text-xs uppercase text-white/40">{item.status}</span>
                  ) : null}
                </div>
                {typeof item.progress === 'number' ? (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-green-500"
                      style={{
                        width: `${Math.min(100, Math.max(0, item.progress))}%`,
                      }}
                    />
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
      <Button
        size="sm"
        variant="outline"
        className="mt-2 border-red-500/30 text-red-300 hover:bg-red-500/10 hover:text-red-200"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}
