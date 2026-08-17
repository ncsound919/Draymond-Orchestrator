'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ccFetch } from '@/app/command-center/actions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DAY_PHASES,
  agentHealthyCount,
  brainHealth,
  jobEnabledCount,
  relativeTime,
  type BrainPayload,
  type ChainLike,
  type DayPlanResponse,
  type DayPhase,
  type FleetAgent,
  type JobLike,
  type PhaseRunResult,
} from '../fleet-lib';

const BRAIN_DOT = {
  online: 'bg-green-400',
  degraded: 'bg-yellow-400',
  offline: 'bg-red-400',
} as const;

export default function HomePanel() {
  const queryClient = useQueryClient();

  const agentsQuery = useQuery({
    queryKey: ['command-center', 'agents'],
    queryFn: async () => {
      const res = await ccFetch<{ agents: FleetAgent[]; total: number }>({
        endpoint: '/api/v1/agents',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data?.agents ?? [];
    },
  });

  const jobsQuery = useQuery({
    queryKey: ['command-center', 'jobs'],
    queryFn: async () => {
      const res = await ccFetch<{ ok: boolean; jobs: JobLike[] }>({
        endpoint: '/api/jobs',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data?.jobs ?? [];
    },
  });

  const chainsQuery = useQuery({
    queryKey: ['command-center', 'chains'],
    queryFn: async () => {
      const res = await ccFetch<{ ok: boolean; chains: ChainLike[] }>({
        endpoint: '/api/chains',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data?.chains ?? [];
    },
  });

  const dayQuery = useQuery({
    queryKey: ['command-center', 'ops-day'],
    queryFn: async () => {
      const res = await ccFetch<DayPlanResponse>({
        endpoint: '/api/ops/day',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
  });

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

  const runPhase = useMutation({
    mutationFn: async (phase: DayPhase) => {
      const res = await ccFetch<PhaseRunResult>({
        endpoint: `/api/ops/day?phase=${phase}`,
        method: 'POST',
        body: {},
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (data, phase) => {
      const executed = data?.executed?.length ?? 0;
      const errors = data?.errors?.length ?? 0;
      toast.success(
        `Phase ${phase} complete — ${executed} step(s) run${
          errors > 0 ? `, ${errors} error(s)` : ''
        }`,
      );
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'ops-day'] });
    },
    onError: (err, phase) => {
      toast.error(
        `Failed to run ${phase} phase: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  const loading =
    agentsQuery.isLoading ||
    jobsQuery.isLoading ||
    chainsQuery.isLoading ||
    dayQuery.isLoading ||
    brainQuery.isLoading;

  const agents = agentsQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const chains = chainsQuery.data ?? [];
  const brain = brainQuery.data?.brain ?? null;
  const brainState = brainHealth(brain);

  const pulse = [
    {
      label: 'Agents',
      value: String(agents.length),
      sub: `${agentHealthyCount(agents)} healthy`,
      dot: 'bg-green-400',
    },
    {
      label: 'Jobs',
      value: String(jobs.length),
      sub: `${jobEnabledCount(jobs)} enabled`,
      dot: 'bg-blue-400',
    },
    {
      label: 'Chains',
      value: String(chains.length),
      sub: 'in registry',
      dot: 'bg-purple-400',
    },
    {
      label: 'Brain',
      value: brainState,
      sub: brain?.last_run_at ? relativeTime(brain.last_run_at) : 'no run recorded',
      dot: BRAIN_DOT[brainState],
    },
  ];

  const phases = DAY_PHASES.map((phase) => ({
    phase,
    steps: dayQuery.data?.byPhase?.[phase] ?? [],
    budget: dayQuery.data?.phaseBudgets?.[phase],
  }));

  const agenda = brainQuery.data?.agenda ?? [];

  return (
    <div className="space-y-8">
      {/* ── Fleet pulse ─────────────────────────────────────────────── */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {pulse.map((p) => (
            <div key={p.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
              {loading ? (
                <>
                  <Skeleton className="h-4 w-20 bg-white/10" />
                  <Skeleton className="mt-3 h-8 w-16 bg-white/10" />
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-white/40">
                      {p.label}
                    </span>
                    <span className={`h-2.5 w-2.5 rounded-full ${p.dot}`} />
                  </div>
                  <div className="mt-2 text-2xl font-bold text-white capitalize">{p.value}</div>
                  <div className="text-xs text-white/40">{p.sub}</div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Day plan ────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Day Plan</h2>
          {dayQuery.data?.nextDue ? (
            <span className="text-xs text-white/40">
              Next due: <span className="text-white/70">{dayQuery.data.nextDue.job}</span> at{' '}
              <span className="font-mono">{dayQuery.data.nextDue.time}</span>
            </span>
          ) : null}
        </div>
        {dayQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full bg-white/10" />
            <Skeleton className="h-28 w-full bg-white/10" />
          </div>
        ) : dayQuery.isError ? (
          <ErrorCard message={dayQuery.error.message} onRetry={() => void dayQuery.refetch()} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {phases.map(({ phase, steps, budget }) => (
              <div key={phase} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white capitalize">{phase}</h3>
                    <p className="text-xs text-white/40">
                      {steps.length} step(s)
                      {typeof budget === 'number'
                        ? ` · ~${budget.toLocaleString()} tokens`
                        : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={runPhase.isPending && runPhase.variables === phase}
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => runPhase.mutate(phase)}
                  >
                    {runPhase.isPending && runPhase.variables === phase ? 'Running…' : 'Run'}
                  </Button>
                </div>
                {steps.length === 0 ? (
                  <p className="text-xs text-white/40">No steps scheduled for this phase.</p>
                ) : (
                  <ul className="space-y-2">
                    {steps.map((step) => (
                      <li key={step.id} className="text-sm">
                        <span className="font-mono text-xs text-white/40">{step.time}</span>
                        <span className="ml-2 text-white">{step.job}</span>
                        <p className="text-xs text-white/40">{step.purpose}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Recent alerts / brain agenda ────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Recent Alerts</h2>
        {brainQuery.isLoading ? (
          <Skeleton className="h-20 w-full bg-white/10" />
        ) : brainQuery.isError ? (
          <ErrorCard
            message={brainQuery.error.message}
            onRetry={() => void brainQuery.refetch()}
          />
        ) : agenda.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            No active agenda items.
          </div>
        ) : (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
            {agenda.map((item, index) => (
              <div key={`${item.title ?? index}`} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-white">{item.title ?? 'Untitled agenda item'}</span>
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

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
      <p className="text-sm text-red-300">Failed to load: {message}</p>
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
