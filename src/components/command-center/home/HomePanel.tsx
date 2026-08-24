'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ccFetch } from '@/app/command-center/actions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  DAY_PHASES,
  brainHealth,
  type BrainPayload,
  type BrainDecisionResult,
  type DayPhase,
  type FleetAgent,
  type PhaseRunResult,
} from '../fleet-lib';
import {
  feedStatusPill,
  mergeFeed,
  discoveryScoreLabel,
  sortDiscoveries,
  gaugeValue,
  parsePrometheusGauges,
  type DiscoveryLike,
  type FeedEntry,
  type HeartbeatLike,
  type JobFeedLike,
  type RepairAttemptLike,
} from '../home-lib';
import type { FleetControls } from '@/lib/command-center/controls';

const BRAIN_DOT = {
  online: 'bg-green-400',
  degraded: 'bg-yellow-400',
  offline: 'bg-red-400',
} as const;

const REPAIR_FEED_LIMIT = 30;

export default function HomePanel() {
  const queryClient = useQueryClient();

  // ── Fetch fleet pulse (same as before) ────────────────────────────────
  const agentsQuery = useQuery({
    queryKey: ['command-center', 'agents'],
    queryFn: async () => {
      const res = await ccFetch<{ agents: FleetAgent[] }>({ endpoint: '/api/v1/agents', method: 'GET' });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data?.agents ?? [];
    },
  });

  const jobsQuery = useQuery({
    queryKey: ['command-center', 'jobs'],
    queryFn: async () => {
      const res = await ccFetch<{ ok: boolean; jobs: unknown[] }>({ endpoint: '/api/jobs', method: 'GET' });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data?.jobs ?? [];
    },
  });

  const brainQuery = useQuery({
    queryKey: ['command-center', 'ops-brain'],
    queryFn: async () => {
      const res = await ccFetch<BrainPayload>({ endpoint: '/api/ops/brain', method: 'GET' });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
  });

  // ── New live feeds (polling) ──────────────────────────────────────────
  const controlsQuery = useQuery({
    queryKey: ['command-center', 'controls'],
    queryFn: async () => {
      const res = await ccFetch<{ controls: FleetControls; effective: FleetControls; source: string }>({
        endpoint: '/api/ops/controls',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    refetchOnWindowFocus: true,
  });

  const heartbeatsQuery = useQuery({
    queryKey: ['command-center', 'ops-heartbeats'],
    queryFn: async () => {
      const res = await ccFetch<{ heartbeats: Record<string, HeartbeatLike> | HeartbeatLike[] }>({
        endpoint: '/api/ops/heartbeats',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data?.heartbeats ?? {};
    },
    refetchInterval: 10_000,
  });

  const repairsQuery = useQuery({
    queryKey: ['command-center', 'ops-repair'],
    queryFn: async () => {
      const res = await ccFetch<{ log: RepairAttemptLike[] }>({ endpoint: '/api/ops/repair', method: 'GET' });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data?.log ?? [];
    },
    refetchInterval: 10_000,
  });

  const trendsQuery = useQuery({
    queryKey: ['command-center', 'ops-trends'],
    queryFn: async () => {
      const [learnRes, metricsRes] = await Promise.all([
        ccFetch<{ discoveries?: DiscoveryLike[] }>({
          endpoint: '/api/ops/learning?include=discoveries',
          method: 'GET',
        }),
        ccFetch<string>({ endpoint: '/api/ops/metrics', method: 'GET' }),
      ]);
      const discoveries = learnRes.ok ? (learnRes.data?.discoveries ?? []) : [];
      const metricsText = metricsRes.ok && typeof metricsRes.data === 'string' ? metricsRes.data : '';
      return { discoveries, metrics: metricsText };
    },
    refetchInterval: 60_000,
  });

  const servicesQuery = useQuery({
    queryKey: ['command-center', 'ops-services'],
    queryFn: async () => {
      const res = await ccFetch<{
        catalog: Array<{ slug: string; name: string; port: number | null; health: string; env: string }>;
        health: Array<{ slug: string; name: string; url: string | null; up: boolean; detail: string; statusCode?: number | null }>;
      }>({
        endpoint: '/api/ops/services',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      const healthMap = new Map((res.data?.health ?? []).map((svc) => [svc.slug, svc]));
      return (res.data?.catalog ?? []).map((svc) => ({ ...svc, ...healthMap.get(svc.slug) }));
    },
    refetchInterval: 20_000,
  });

  // ── Local knob state (init from controls) ─────────────────────────────
  const storedControls = controlsQuery.data?.controls;
  const [draft, setDraft] = useState<FleetControls | null>(null);

  useEffect(() => {
    if (storedControls && !draft) setDraft(storedControls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedControls]);

  const saveControls = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('No control draft to save');
      const res = await ccFetch<{ ok: boolean; controls: FleetControls }>({
        endpoint: '/api/ops/controls',
        method: 'PATCH',
        body: draft as unknown as Record<string, unknown>,
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data?.controls;
    },
    onSuccess: () => {
      toast.success('Controls saved');
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'controls'] });
    },
    onError: (err) => toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  // ── Quick action mutations ────────────────────────────────────────────
  const runPhase = useMutation({
    mutationFn: async (phase: DayPhase) => {
      const res = await ccFetch<PhaseRunResult>({ endpoint: `/api/ops/day?phase=${phase}`, method: 'POST', body: {} });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (data, phase) => {
      const executed = data?.executed?.length ?? 0;
      const errors = data?.errors?.length ?? 0;
      toast.success(`Phase ${phase} complete — ${executed} step(s) run${errors > 0 ? `, ${errors} error(s)` : ''}`);
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'ops-day'] });
    },
    onError: (err, phase) => toast.error(`Failed to run ${phase} phase: ${err instanceof Error ? err.message : String(err)}`),
  });

  const runBrainCycle = useMutation({
    mutationFn: async () => {
      const res = await ccFetch<BrainDecisionResult>({ endpoint: '/api/ops/brain', method: 'POST', body: {} });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`Decision cycle complete — ${data?.actions?.length ?? 0} action(s)`);
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'ops-brain'] });
    },
    onError: (err) => toast.error(`Decision cycle failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  const runHeartbeatSweep = useMutation({
    mutationFn: async () => {
      const res = await ccFetch<Record<string, unknown>>({ endpoint: '/api/ops/heartbeats', method: 'POST', body: {} });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Heartbeat sweep complete');
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'ops-heartbeats'] });
    },
    onError: (err) => toast.error(`Sweep failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  const attemptRepair = useMutation({
    mutationFn: async (vars: { signal: string; detail: string }) => {
      const res = await ccFetch<RepairAttemptLike>({
        endpoint: '/api/ops/repair',
        method: 'POST',
        body: { signal: vars.signal, detail: vars.detail },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`Repair attempt: ${data?.status ?? 'unknown'} — ${data?.signal ?? ''}`);
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'ops-repair'] });
    },
    onError: (err) => toast.error(`Repair failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  const startServiceMutation = useMutation({
    mutationFn: async ({ slug, action }: { slug: string; action: 'start' | 'restart' }) => {
      const res = await ccFetch<{ ok?: boolean; service?: { slug: string; up: boolean; detail: string } }>({
        endpoint: '/api/ops/services',
        method: 'POST',
        body: { slug, action },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (_data, vars) => {
      toast.success(`${vars.action === 'restart' ? 'Restarted' : 'Started'} ${vars.slug}`);
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'ops-services'] });
    },
    onError: (err, vars) => {
      toast.error(`Failed to ${vars.action} ${vars.slug}: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const startAllServicesMutation = useMutation({
    mutationFn: async () => {
      const res = await ccFetch<{ checked: number; up: number; down: string[]; started?: Array<{ slug: string; up: boolean; detail: string }> }>({
        endpoint: '/api/ops/services',
        method: 'POST',
        body: { start: true },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (data) => {
      const started = data?.started?.filter((svc) => svc.up).length ?? 0;
      toast.success(`Started ${started} service(s); ${data?.up ?? 0} up total`);
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'ops-services'] });
    },
    onError: (err) => toast.error(`Fleet start failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  // ── Derived data ──────────────────────────────────────────────────────
  const agents = agentsQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const brain = brainQuery.data?.brain ?? null;
  const brainState = brainHealth(brain);
  const activeCount = agents.filter((a) => a.status === 'active').length;

  const heartbeats = heartbeatsQuery.data ?? {};
  const repairs = repairsQuery.data ?? [];
  const feed: FeedEntry[] = mergeFeed(heartbeats, repairs, jobs as JobFeedLike[], 50);

  const discoveries = sortDiscoveries(trendsQuery.data?.discoveries, 12);
  const gauges = parsePrometheusGauges(trendsQuery.data?.metrics);
  const metrics = [
    { label: 'Agents', value: gaugeValue(gauges, 'draymond_agents_total', agents.length) },
    { label: 'Repairs', value: gaugeValue(gauges, 'draymond_repair_attempts_total') },
    { label: 'Events 24h', value: gaugeValue(gauges, 'draymond_events_total_24h') },
    { label: 'Lessons', value: gaugeValue(gauges, 'draymond_lessons_total') },
  ];

  const [repairSignal, setRepairSignal] = useState('');
  const [repairDetail, setRepairDetail] = useState('');

  return (
    <div className="space-y-8">
      {/* ── Quick actions ─────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Quick Actions</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={runBrainCycle.isPending}
            className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            onClick={() => runBrainCycle.mutate()}
          >
            {runBrainCycle.isPending ? 'Running…' : 'Run decision cycle'}
          </Button>
          <Button
            variant="outline"
            disabled={runHeartbeatSweep.isPending}
            className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            onClick={() => runHeartbeatSweep.mutate()}
          >
            {runHeartbeatSweep.isPending ? 'Sweeping…' : 'Heartbeat sweep'}
          </Button>
          {DAY_PHASES.map((phase) => (
            <Button
              key={phase}
              size="sm"
              variant="outline"
              disabled={runPhase.isPending && runPhase.variables === phase}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white capitalize"
              onClick={() => runPhase.mutate(phase)}
            >
              {runPhase.isPending && runPhase.variables === phase ? 'Running…' : `Run ${phase}`}
            </Button>
          ))}
        </div>
      </section>

      {/* ── Pulse ─────────────────────────────────────────────────────── */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Pulse label="Agents" value={String(agents.length)} sub={`${activeCount} active`} dot="bg-green-400" loading={agentsQuery.isLoading} />
          <Pulse label="Jobs" value={String(jobs.length)} sub="scheduled" dot="bg-blue-400" loading={jobsQuery.isLoading} />
          <Pulse label="Brain" value={brainState} sub={brain?.last_run_at ? timeAgo(brain.last_run_at) : 'no run'} dot={BRAIN_DOT[brainState]} loading={brainQuery.isLoading} />
          <Pulse label="Discoveries" value={String(discoveries.length)} sub="latest" dot="bg-purple-400" loading={trendsQuery.isLoading} />
          <Pulse label="Repairs" value={String(repairs.length)} sub="recent" dot="bg-orange-400" loading={repairsQuery.isLoading} />
        </div>
      </section>

      {/* ── Fleet activation controls ─────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Fleet activation</h2>
          <Button
            size="sm"
            variant="outline"
            disabled={startAllServicesMutation.isPending || servicesQuery.isLoading}
            className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            onClick={() => startAllServicesMutation.mutate()}
          >
            {startAllServicesMutation.isPending ? 'Starting…' : 'Start all startable'}
          </Button>
        </div>
        {servicesQuery.isLoading ? (
          <Skeleton className="h-28 w-full bg-white/10" />
        ) : servicesQuery.isError ? (
          <ErrorCard message={servicesQuery.error.message} onRetry={() => void servicesQuery.refetch()} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {(servicesQuery.data ?? []).slice(0, 9).map((svc) => (
              <div key={svc.slug} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">{svc.name}</div>
                    <div className="mt-1 text-[11px] text-white/40">{svc.slug} • {svc.port ?? 'n/a'}</div>
                  </div>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${svc.up ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                    {svc.up ? 'active' : 'offline'}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={startServiceMutation.isPending}
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => startServiceMutation.mutate({ slug: svc.slug, action: 'start' })}
                  >
                    {svc.up ? 'Activate' : 'Start'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={startServiceMutation.isPending}
                    className="border-orange-500/30 text-orange-300 hover:bg-orange-500/10 hover:text-orange-200"
                    onClick={() => startServiceMutation.mutate({ slug: svc.slug, action: 'restart' })}
                  >
                    Restart
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Controls (knobs & sliders) ────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Controls</h2>
          <div className="flex items-center gap-2">
            {storedControls?.updatedAt ? (
              <span className="text-xs text-white/40">Saved {timeAgo(storedControls.updatedAt)}</span>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={saveControls.isPending || !draft}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              onClick={() => saveControls.mutate()}
            >
              {saveControls.isPending ? 'Saving…' : 'Save controls'}
            </Button>
          </div>
        </div>
        {controlsQuery.isLoading ? (
          <Skeleton className="h-48 w-full bg-white/10" />
        ) : controlsQuery.isError ? (
          <ErrorCard message={controlsQuery.error.message} onRetry={() => void controlsQuery.refetch()} />
        ) : !draft ? null : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ControlCard title="Repair guard">
              <Knob
                label="Cooldown (min)"
                value={draft.repair.cooldownMinutes}
                min={1} max={1440} step={5}
                onChange={(v) => setDraft((d) => (d ? { ...d, repair: { ...d.repair, cooldownMinutes: v } } : d))}
              />
              <Knob
                label="Max in cooldown"
                value={draft.repair.maxInCooldown}
                min={1} max={10} step={1}
                onChange={(v) => setDraft((d) => (d ? { ...d, repair: { ...d.repair, maxInCooldown: v } } : d))}
              />
              <Knob
                label="Loop threshold"
                value={draft.repair.loopThreshold}
                min={1} max={10} step={1}
                onChange={(v) => setDraft((d) => (d ? { ...d, repair: { ...d.repair, loopThreshold: v } } : d))}
              />
            </ControlCard>

            <ControlCard title="Discovery loop">
              <label className="flex items-center justify-between gap-3 text-sm text-white/70">
                <span>Enabled</span>
                <Switch
                  checked={draft.discovery.enabled}
                  onCheckedChange={(checked) =>
                    setDraft((d) => (d ? { ...d, discovery: { ...d.discovery, enabled: checked } } : d))
                  }
                />
              </label>
              <Knob
                label="Interval (min)"
                value={draft.discovery.intervalMinutes}
                min={5} max={480} step={5}
                onChange={(v) => setDraft((d) => (d ? { ...d, discovery: { ...d.discovery, intervalMinutes: v } } : d))}
              />
              <Knob
                label="Iterations / run"
                value={draft.discovery.iterations}
                min={1} max={3} step={1}
                onChange={(v) => setDraft((d) => (d ? { ...d, discovery: { ...d.discovery, iterations: v } } : d))}
              />
            </ControlCard>

            <ControlCard title="Fleet aggressiveness">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/70">Daily budget</span>
                  <span className="font-mono text-xs text-white/60">
                    {(draft.fleet.dailyBudgetTokens / 1_000_000).toFixed(1)}M
                  </span>
                </div>
                <Slider
                  value={draft.fleet.dailyBudgetTokens}
                  min={100_000}
                  max={100_000_000}
                  step={100_000}
                  onValueChange={(v) =>
                    setDraft((d) => (d ? { ...d, fleet: { ...d.fleet, dailyBudgetTokens: Number(v) } } : d))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {(['free', 'flash', 'pro'] as const).map((tier) => (
                  <button
                    key={tier}
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, fleet: { ...d.fleet, tiers: { ...d.fleet.tiers, [tier]: !d.fleet.tiers[tier] } } } : d,
                      )
                    }
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      draft.fleet.tiers[tier]
                        ? 'bg-white/15 text-white'
                        : 'bg-white/5 text-white/30 line-through'
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </ControlCard>
          </div>
        )}
      </section>

      {/* ── Happenings ────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Happenings</h2>
          <span className="text-xs text-white/40">auto-refreshes every 10s</span>
        </div>
        {heartbeatsQuery.isLoading || repairsQuery.isLoading ? (
          <Skeleton className="h-40 w-full bg-white/10" />
        ) : feed.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            No recent activity.
          </div>
        ) : (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5 max-h-[360px] overflow-y-auto">
            {feed.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className={`mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${feedStatusPill(entry.status)}`}>
                  {entry.source}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-white">{entry.title}</span>
                    <span className="shrink-0 text-xs text-white/30">{timeAgo(entry.at)}</span>
                  </div>
                  <p className="truncate text-xs text-white/40">{entry.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Repair triage ─────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Repair Triage</h2>
        <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              value={repairSignal}
              onChange={(e) => setRepairSignal(e.target.value)}
              placeholder="signal (e.g. job:error, monitor:down)"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
            />
            <input
              value={repairDetail}
              onChange={(e) => setRepairDetail(e.target.value)}
              placeholder="detail"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={attemptRepair.isPending || !repairSignal.trim()}
            className="mt-3 border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            onClick={() => attemptRepair.mutate({ signal: repairSignal.trim(), detail: repairDetail.trim() || repairSignal.trim() })}
          >
            {attemptRepair.isPending ? 'Attempting…' : 'Attempt repair'}
          </Button>
        </div>
        {repairs.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">No repair attempts recorded.</div>
        ) : (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5 max-h-[260px] overflow-y-auto">
            {repairs.slice(0, REPAIR_FEED_LIMIT).map((r) => (
              <div key={r.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${feedStatusPill(r.status)}`}>
                  {r.status ?? 'unknown'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-white">{r.signal ?? 'repair'}</span>
                    <span className="shrink-0 text-xs text-white/30">{timeAgo(r.detectedAt)}</span>
                  </div>
                  <p className="truncate text-xs text-white/40">{r.detail ?? r.action?.name ?? ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Trend discoveries ─────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Trend Discoveries</h2>
          <button
            className="text-xs text-white/40 hover:text-white"
            onClick={() => void trendsQuery.refetch()}
          >
            Refresh
          </button>
        </div>
        <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-xs uppercase tracking-wider text-white/40">{m.label}</div>
              <div className="text-xl font-bold text-white">{m.value}</div>
            </div>
          ))}
        </div>
        {trendsQuery.isLoading ? (
          <Skeleton className="h-24 w-full bg-white/10" />
        ) : discoveries.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            No discoveries yet.
          </div>
        ) : (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
            {discoveries.map((d) => (
              <div key={d.goalId} className="flex items-start gap-3 px-4 py-2.5">
                <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${discoveryScoreLabel(d.score)}`}>
                  {Math.round(d.score)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-white">{d.title ?? 'Untitled'}</span>
                    <span className="shrink-0 text-xs text-white/30">{timeAgo(d.gradedAt)}</span>
                  </div>
                  <p className="truncate text-xs text-white/40">
                    {[d.domain, d.area, d.evidenceTier].filter(Boolean).join(' · ') || d.trend || ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Small presentational pieces ────────────────────────────────────────────

function Pulse({
  label, value, sub, dot, loading,
}: { label: string; value: string; sub: string; dot: string; loading: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      {loading ? (
        <>
          <Skeleton className="h-4 w-20 bg-white/10" />
          <Skeleton className="mt-3 h-8 w-16 bg-white/10" />
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-white/40">{label}</span>
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
          </div>
          <div className="mt-2 text-2xl font-bold text-white capitalize">{value}</div>
          <div className="text-xs text-white/40">{sub}</div>
        </>
      )}
    </div>
  );
}

function ControlCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Knob({
  label, value, min, max, step, onChange,
}: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-white/70">{label}</span>
        <span className="font-mono text-xs text-white/60">{value}</span>
      </div>
      <Slider value={value} min={min} max={max} step={step} onValueChange={(v) => onChange(Number(v))} />
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

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return '—';
  const diff = Date.now() - d;
  if (diff < 0) return 'now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
