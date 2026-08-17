'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ccFetch } from '@/app/command-center/actions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  chainStatusBadge,
  formatDateTime,
  jobStatusBadge,
  relativeTime,
  type ChainLike,
  type JobLike,
} from '../fleet-lib';

export default function TasksPanel() {
  const queryClient = useQueryClient();

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

  const toggleMutation = useMutation({
    mutationFn: async (vars: { id: string; enabled: boolean }) => {
      const res = await ccFetch<{ ok: boolean; job?: JobLike }>({
        endpoint: '/api/jobs',
        method: 'PATCH',
        body: { id: vars.id, action: vars.enabled ? 'enable' : 'disable' },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res;
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['command-center', 'jobs'] });
      const previous = queryClient.getQueryData<JobLike[]>(['command-center', 'jobs']);
      queryClient.setQueryData<JobLike[]>(['command-center', 'jobs'], (old) =>
        (old ?? []).map((j) => (j.id === vars.id ? { ...j, is_enabled: vars.enabled } : j)),
      );
      return { previous };
    },
    onError: (err, vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['command-center', 'jobs'], context.previous);
      }
      toast.error(
        `Failed to ${vars.enabled ? 'enable' : 'disable'} job: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'jobs'] });
    },
  });

  const triggerMutation = useMutation({
    mutationFn: async (chain: ChainLike) => {
      const res = await ccFetch<{ ok: boolean; chain_id?: string }>({
        endpoint: `/api/chains/${chain.id}/execute`,
        method: 'POST',
        body: { input: {} },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return { chain, res };
    },
    onSuccess: ({ chain, res }) => {
      const chainId = res.data?.chain_id;
      toast.success(`Chain "${chain.name}" triggered${chainId ? ` (${chainId})` : ''}`);
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'chains'] });
    },
    onError: (err, chain) => {
      toast.error(
        `Failed to trigger "${chain.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  const jobs = jobsQuery.data ?? [];
  const chains = chainsQuery.data ?? [];

  return (
    <Tabs defaultValue="jobs" className="w-full">
      <TabsList className="border border-white/10 bg-white/5 text-white/60">
        <TabsTrigger value="jobs">Jobs ({jobs.length})</TabsTrigger>
        <TabsTrigger value="chains">Chains ({chains.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="jobs" className="mt-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Scheduled Jobs</h2>
        {jobsQuery.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full bg-white/10" />
            ))}
          </div>
        ) : jobsQuery.isError ? (
          <ErrorCard message={jobsQuery.error.message} onRetry={() => void jobsQuery.refetch()} />
        ) : jobs.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            No scheduled jobs.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="text-xs text-white/40">Name</TableHead>
                  <TableHead className="text-xs text-white/40">Type</TableHead>
                  <TableHead className="text-xs text-white/40">Cron</TableHead>
                  <TableHead className="text-xs text-white/40">Last run</TableHead>
                  <TableHead className="text-xs text-white/40">Next run</TableHead>
                  <TableHead className="text-xs text-white/40">Status</TableHead>
                  <TableHead className="text-xs text-white/40">Enabled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id} className="border-white/5 hover:bg-white/5">
                    <TableCell className="font-medium text-white">{job.name}</TableCell>
                    <TableCell className="text-xs text-white/40">
                      {job.job_type ?? '—'}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-white/60">
                        {job.cron_expression ?? '—'}
                      </code>
                    </TableCell>
                    <TableCell className="text-xs text-white/40">
                      {relativeTime(job.last_run_at)}
                    </TableCell>
                    <TableCell className="text-xs text-white/40">
                      {formatDateTime(job.next_run_at)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${jobStatusBadge(job.last_run_status)}`}
                      >
                        {job.last_run_status ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={job.is_enabled === true}
                        disabled={toggleMutation.isPending}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({ id: job.id, enabled: checked })
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="chains" className="mt-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Chains</h2>
        {chainsQuery.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full bg-white/10" />
            ))}
          </div>
        ) : chainsQuery.isError ? (
          <ErrorCard
            message={chainsQuery.error.message}
            onRetry={() => void chainsQuery.refetch()}
          />
        ) : chains.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            No chains registered.
          </div>
        ) : (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
            {chains.map((chain) => {
              const total = chain.total_steps ?? 0;
              const completed = chain.completed_steps ?? 0;
              const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
              const pending =
                triggerMutation.isPending && triggerMutation.variables?.id === chain.id;
              return (
                <div
                  key={chain.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">
                        {chain.name}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${chainStatusBadge(chain.status)}`}
                      >
                        {chain.status}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-white/40">
                        {completed}/{total} steps
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || chain.is_template === false}
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => triggerMutation.mutate(chain)}
                  >
                    {pending ? 'Triggering…' : 'Trigger'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </TabsContent>
    </Tabs>
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
