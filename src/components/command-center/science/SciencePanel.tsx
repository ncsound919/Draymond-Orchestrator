'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, FlaskConical, Loader2, Send, WifiOff } from 'lucide-react';

import { ccFetch } from '@/app/command-center/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  paperSourceLabel,
  paperYearLabel,
  papersByGoal,
  type PaperLike,
} from '../sites-lib';
import {
  discoveryPill,
  experimentStatusPill,
  experimentTypeLabel,
  goalStatusPill,
  priorityLabel,
  priorityPill,
  sortDiscoveriesByScore,
  type DiscoveryLike,
  type ExperimentLike,
  type GoalLike,
} from '../sci-lib';

interface PublishStatus {
  ok?: boolean;
  brainConfigured?: boolean;
  endpoint?: string;
}
interface PapersResponse {
  ok?: boolean;
  papers?: Record<string, PaperLike[]>;
}
interface PublishResponse {
  ok?: boolean;
  output?: string;
  error?: string;
}
interface GoalsResponse {
  ok?: boolean;
  goals?: GoalLike[];
  error?: string;
}
interface ExperimentsResponse {
  ok?: boolean;
  experiments?: ExperimentLike[];
  next?: ExperimentLike;
  error?: string;
}
interface GradeResponse {
  ok?: boolean;
  graded?: number;
  discoveries?: DiscoveryLike[];
  error?: string;
}
interface SimResponse {
  ok?: boolean;
  error?: string;
}

function snippetOf(output: string | undefined, max = 180): string {
  const trimmed = (output ?? '').trim();
  if (!trimmed) return '';
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export default function SciencePanel() {
  const [topic, setTopic] = useState('');
  const [modelId, setModelId] = useState('');
  const [ticks, setTicks] = useState(100);

  // -- Brain status banner (existing) ----------------------------------------
  const statusQuery = useQuery({
    queryKey: ['command-center', 'science', 'status'],
    queryFn: async () => {
      const res = await ccFetch<PublishStatus>({ endpoint: '/api/command-center/science/publish', method: 'GET' });
      if (!res.ok) throw new Error(res.error ?? 'Failed to load brain status');
      return res.data;
    },
  });

  // -- Goals (CureMind / biotech) --------------------------------------------
  const goalsQuery = useQuery({
    queryKey: ['command-center', 'science', 'goals'],
    queryFn: async () => {
      const res = await ccFetch<GoalsResponse>({ endpoint: '/api/v1/science/goals', method: 'GET' });
      if (!res.ok) throw new Error(res.error ?? 'Failed to load goals');
      return res.data?.goals ?? [];
    },
  });

  const setGoalStatus = useMutation({
    mutationFn: async (vars: { id: string; status: string }) => {
      const res = await ccFetch<{ ok: boolean; goal?: GoalLike }>({
        endpoint: '/api/v1/science/goals',
        method: 'POST',
        body: { goal_id: vars.id, status: vars.status },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('Goal status updated');
      void goalsQuery.refetch();
    },
    onError: (err) => toast.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  // -- Experiments -----------------------------------------------------------
  const experimentsQuery = useQuery({
    queryKey: ['command-center', 'science', 'experiments'],
    queryFn: async () => {
      const res = await ccFetch<ExperimentsResponse>({ endpoint: '/api/v1/science/experiments', method: 'GET' });
      if (!res.ok) throw new Error(res.error ?? 'Failed to load experiments');
      return res.data?.experiments ?? [];
    },
  });

  const runExperiment = useMutation({
    mutationFn: async (mode: 'next' | 'rotation') => {
      const res = await ccFetch<ExperimentsResponse>({
        endpoint: '/api/v1/science/experiments',
        method: 'POST',
        body: { mode },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (data, mode) => {
      if (mode === 'next') toast.success(data?.next?.id ? `Drained next: ${data.next.id}` : 'Queue empty');
      else toast.success('Research rotation complete');
      void experimentsQuery.refetch();
      void goalsQuery.refetch();
    },
    onError: (err) => toast.error(`Experiment action failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  // -- Research grade --------------------------------------------------------
  const gradeQuery = useQuery({
    queryKey: ['command-center', 'science', 'grade'],
    queryFn: async () => {
      const res = await ccFetch<GradeResponse>({ endpoint: '/api/v1/science/grade', method: 'GET' });
      if (!res.ok) throw new Error(res.error ?? 'Failed to load discoveries');
      return res.data?.discoveries ?? [];
    },
  });

  const runGrade = useMutation({
    mutationFn: async () => {
      const res = await ccFetch<GradeResponse>({ endpoint: '/api/v1/science/grade', method: 'POST', body: {} });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (data) => {
      toast.success(`Research grade complete — ${data?.graded ?? 0} goal(s) graded`);
      void gradeQuery.refetch();
    },
    onError: (err) => toast.error(`Grade failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  // -- Simulation ------------------------------------------------------------
  const runSim = useMutation({
    mutationFn: async (input?: { modelId?: string; ticksOverride?: number }) => {
      const targetModelId = (input?.modelId ?? modelId).trim();
      if (!targetModelId) throw new Error('model_id is required');
      const targetTicks = input?.ticksOverride ?? ticks;
      const res = await ccFetch<SimResponse>({
        endpoint: '/api/v1/science/simulations',
        method: 'POST',
        body: { model_id: targetModelId, ticks: targetTicks },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res.data;
    },
    onSuccess: (_data, input) => {
      const targetModelId = (input?.modelId ?? modelId).trim();
      toast.success(`Simulation "${targetModelId}" complete`);
    },
    onError: (err) => toast.error(`Simulation failed: ${err instanceof Error ? err.message : String(err)}`),
  });

  // -- Publish (existing) ----------------------------------------------------
  const publish = useMutation({
    mutationFn: async (value: string) => {
      const res = await ccFetch<PublishResponse>({
        endpoint: '/api/command-center/science/publish',
        method: 'POST',
        body: { topic: value },
      });
      if (!res.ok) throw new Error(res.data?.error ?? res.error ?? 'Publish failed');
      return res.data;
    },
    onSuccess: (data) => {
      const snippet = snippetOf(data?.output);
      if (snippet) toast.success(`Paper published — ${snippet}`);
      else toast.success('Paper published');
      setTopic('');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Publish failed'),
  });

  const papersQuery = useQuery({
    queryKey: ['command-center', 'science', 'papers'],
    queryFn: async () => {
      const res = await ccFetch<PapersResponse>({ endpoint: '/api/research/papers', method: 'GET' });
      if (!res.ok) throw new Error(res.error ?? 'Failed to load papers');
      return res.data?.papers ?? {};
    },
  });

  const handlePublish = () => {
    const trimmed = topic.trim();
    if (!trimmed) {
      toast.error('Topic is required');
      return;
    }
    publish.mutate(trimmed);
  };

  const groups = papersByGoal(papersQuery.data);
  const brainConfigured = statusQuery.data?.brainConfigured;
  const brainLoading = statusQuery.isLoading;
  const discoveries = sortDiscoveriesByScore(gradeQuery.data, 10);

  const scientificSystems = [
    {
      key: 'curemind',
      name: 'CureMind',
      summary: 'Autonomous oncology and discovery loop for target prioritization and hypothesis ranking.',
      modelId: 'biotech-01-early-detection',
      accent: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200',
    },
    {
      key: 'cosmos',
      name: 'Cosmos',
      summary: 'Systems-level environmental intelligence and simulation layer across coupled networks.',
      modelId: 'enviro-01-ecohomes',
      accent: 'border-violet-400/30 bg-violet-500/10 text-violet-200',
    },
  ] as const;

  return (
    <div className="space-y-6">
      {/* System overlays */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Scientific systems</h2>
          <span className="text-xs text-white/40">CureMind + Cosmos</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {scientificSystems.map((system) => (
            <Card key={system.key} className={`border ${system.accent}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base text-white">{system.name}</CardTitle>
                  <Badge variant="outline" className="border-white/10 bg-white/5 text-white/70">
                    System
                  </Badge>
                </div>
                <CardDescription className="text-white/60">{system.summary}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                    onClick={() => runSim.mutate({ modelId: system.modelId, ticksOverride: 100 })}
                    disabled={runSim.isPending}
                  >
                    Run simulation
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                    onClick={() => runExperiment.mutate('rotation')}
                    disabled={runExperiment.isPending}
                  >
                    Rotation
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                    onClick={() => runGrade.mutate()}
                    disabled={runGrade.isPending}
                  >
                    Grade
                  </Button>
                </div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/30">
                  Model: {system.modelId}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Brain status banner (existing) */}
      <Card className="border border-white/10 bg-white/5 text-white">
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <FlaskConical className="size-4" />
                Deterministic Brain
              </CardTitle>
              <CardDescription className="text-white/40">
                Paper publishes are routed through the deterministic brain bridge.
              </CardDescription>
            </div>
            {brainLoading ? (
              <Skeleton className="h-6 w-40 bg-white/10" />
            ) : statusQuery.isError ? (
              <Badge variant="outline" className="border-white/10 text-white/40">Status unavailable</Badge>
            ) : brainConfigured ? (
              <Badge className="border-green-500/30 bg-green-500/10 text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" /> Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="border-yellow-500/30 bg-yellow-500/10 text-yellow-400">
                <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" /> Not configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-white/40">
            {brainConfigured
              ? 'The brain is reachable — Global Lens publishes will be processed.'
              : 'BRAIN_URL is not configured. Publishing will fail until the deterministic brain is reachable.'}
          </p>
        </CardContent>
      </Card>

      {/* Goals */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Research Goals</h2>
          <span className="text-xs text-white/40">CureMind / biotech + sports</span>
        </div>
        {goalsQuery.isLoading ? (
          <Skeleton className="h-24 w-full bg-white/10" />
        ) : goalsQuery.isError ? (
          <OfflineState message={goalsQuery.error.message} onRetry={() => void goalsQuery.refetch()} />
        ) : (goalsQuery.data ?? []).length === 0 ? (
          <Card className="border border-white/10 bg-white/5 text-white">
            <CardContent className="py-6"><p className="text-center text-sm text-white/40">No goals.</p></CardContent>
          </Card>
        ) : (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
            {(goalsQuery.data ?? []).map((g) => (
              <div key={g.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${goalStatusPill(g.status)}`}>
                  {g.status ?? '—'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-white">{g.title ?? g.id}</span>
                    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${priorityPill(g.priority)}`}>
                      {priorityLabel(g.priority)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-white/40">
                    {[g.domain, g.area].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <select
                  value={g.status ?? 'active'}
                  disabled={setGoalStatus.isPending}
                  onChange={(e) => setGoalStatus.mutate({ id: g.id, status: e.target.value })}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white outline-none"
                >
                  {['active', 'paused', 'completed', 'archived'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Experiments */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Experiments</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={runExperiment.isPending} className="border-white/10 bg-white/5 text-white hover:bg-white/10" onClick={() => runExperiment.mutate('next')}>
              Drain next
            </Button>
            <Button size="sm" variant="outline" disabled={runExperiment.isPending} className="border-white/10 bg-white/5 text-white hover:bg-white/10" onClick={() => runExperiment.mutate('rotation')}>
              Rotation
            </Button>
          </div>
        </div>
        {experimentsQuery.isLoading ? (
          <Skeleton className="h-24 w-full bg-white/10" />
        ) : experimentsQuery.isError ? (
          <OfflineState message={experimentsQuery.error.message} onRetry={() => void experimentsQuery.refetch()} />
        ) : (experimentsQuery.data ?? []).length === 0 ? (
          <Card className="border border-white/10 bg-white/5 text-white">
            <CardContent className="py-6"><p className="text-center text-sm text-white/40">No experiments.</p></CardContent>
          </Card>
        ) : (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
            {(experimentsQuery.data ?? []).slice(0, 15).map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-4 py-2">
                <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${experimentStatusPill(e.status)}`}>
                  {e.status ?? '—'}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm text-white">{e.title ?? e.id}</span>
                  <p className="truncate text-xs text-white/40">
                    {experimentTypeLabel(e.type)} · {e.goal_id ?? '—'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Simulations */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-white">Simulations</h2>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              className="flex-1 border-white/10 bg-white/5 text-white placeholder:text-white/30"
              placeholder="model_id (from science_engine/models)"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={runSim.isPending}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">ticks</span>
              <input
                type="number"
                value={ticks}
                onChange={(e) => setTicks(Number(e.target.value))}
                className="w-24 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-white outline-none"
              />
            </div>
            <Button
              className="bg-white text-black hover:bg-white/80"
              disabled={runSim.isPending || !modelId.trim()}
              onClick={() => runSim.mutate({ modelId: modelId.trim(), ticksOverride: ticks })}
            >
              {runSim.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {runSim.isPending ? 'Running…' : 'Run simulation'}
            </Button>
          </div>
        </div>
      </section>

      {/* Research grade */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Discoveries</h2>
          <Button size="sm" variant="outline" disabled={runGrade.isPending} className="border-white/10 bg-white/5 text-white hover:bg-white/10" onClick={() => runGrade.mutate()}>
            {runGrade.isPending ? 'Grading…' : 'Run research grade'}
          </Button>
        </div>
        {gradeQuery.isLoading ? (
          <Skeleton className="h-24 w-full bg-white/10" />
        ) : discoveries.length === 0 ? (
          <Card className="border border-white/10 bg-white/5 text-white">
            <CardContent className="py-6"><p className="text-center text-sm text-white/40">No discoveries yet. Run a research grade.</p></CardContent>
          </Card>
        ) : (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
            {discoveries.map((d) => (
              <div key={d.goalId} className="flex items-start gap-3 px-4 py-2.5">
                <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${discoveryPill(d.score)}`}>
                  {Math.round(d.score ?? 0)}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm text-white">{d.title ?? d.goalId}</span>
                  <p className="truncate text-xs text-white/40">
                    {[d.domain, d.area, d.evidenceTier].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Separator className="bg-white/10" />

      {/* Publish (existing) */}
      <Card className="border border-white/10 bg-white/5 text-white">
        <CardHeader>
          <CardTitle className="text-base text-white">Publish a paper</CardTitle>
          <CardDescription className="text-white/40">
            Ask the Global Lens to write and publish a research paper on a topic. This can take up to 90 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="flex-1 border-white/10 bg-white/5 text-white placeholder:text-white/30"
              placeholder="e.g. How do LLM agents decide when to invoke tools?"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !publish.isPending) handlePublish(); }}
              disabled={publish.isPending}
            />
            <Button className="bg-white text-black hover:bg-white/80" disabled={publish.isPending || !topic.trim()} onClick={handlePublish}>
              {publish.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {publish.isPending ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
          {publish.isPending && (
            <p className="mt-2 text-xs text-white/40">
              Running the Global Lens pipeline — this may take up to 90 seconds.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Papers registry (existing) */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Published papers</h2>
          <span className="text-xs text-white/40">
            {papersQuery.data && Object.keys(papersQuery.data).length > 0
              ? `${Object.values(papersQuery.data).reduce((n, p) => n + (Array.isArray(p) ? p.length : 0), 0)} papers`
              : 'Cached from OpenAlex + PubMed'}
          </span>
        </div>
        {papersQuery.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full bg-white/10" />)}
          </div>
        ) : papersQuery.isError ? (
          <OfflineState message={papersQuery.error.message} onRetry={() => void papersQuery.refetch()} />
        ) : groups.length === 0 ? (
          <Card className="border border-white/10 bg-white/5 text-white">
            <CardContent className="py-8">
              <p className="text-center text-sm text-white/40">
                No papers cached yet. Publish a paper above or run the paper refresh pipeline.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-5">
            {groups.map(({ goal, papers }) => (
              <div key={goal} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">{goal}</h3>
                <div className="space-y-2">
                  {papers.map((p) => (
                    <Card key={p.id ?? `${goal}-${p.title}`} className="border border-white/10 bg-white/5 text-white">
                      <CardContent className="py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <a href={p.url || '#'} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-sm font-medium text-white hover:text-white/70">
                              {p.title || 'Untitled'}
                            </a>
                            <p className="mt-1 text-xs text-white/40">
                              {paperYearLabel(p.year)}
                              {p.authors ? ` · ${p.authors}` : ''}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge variant="outline" className="border-white/10 text-white/60">{paperSourceLabel(p.source)}</Badge>
                            {p.url && (
                              <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={`Open paper: ${p.title ?? ''}`} className="text-white/40 hover:text-white">
                                <ExternalLink className="size-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OfflineState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 py-8 text-center">
      <WifiOff className="size-6 text-white/40" />
      <div>
        <p className="text-sm font-medium text-white">Could not reach the bridge</p>
        <p className="mt-1 max-w-sm text-xs text-white/40">{message}</p>
      </div>
      <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
