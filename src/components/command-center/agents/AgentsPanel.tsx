'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { toast } from 'sonner';
import { ccFetch } from '@/app/command-center/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { relativeTime, statusColor, type FleetAgent } from '../fleet-lib';

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, FleetAgent>();

export default function AgentsPanel() {
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

  const invokeMutation = useMutation({
    mutationFn: async (agent: FleetAgent) => {
      const res = await ccFetch<{ ok: boolean; result?: unknown }>({
        endpoint: `/api/agents/${agent.id}/invoke`,
        method: 'POST',
        body: { action: 'health_check', input: {} },
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res;
    },
    onSuccess: (_res, agent) => {
      toast.success(`Health check on ${agent.name} succeeded`);
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'agents'] });
    },
    onError: (err, agent) => {
      toast.error(
        `Health check on ${agent.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  const recoverMutation = useMutation({
    mutationFn: async (agent: FleetAgent) => {
      const res = await ccFetch<{ ok: boolean }>({
        endpoint: `/api/agents/${agent.id}/recover`,
        method: 'POST',
        body: {},
      });
      if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`);
      return res;
    },
    onSuccess: (_res, agent) => {
      toast.success(`Recovery initiated for ${agent.name}`);
      void queryClient.invalidateQueries({ queryKey: ['command-center', 'agents'] });
    },
    onError: (err, agent) => {
      toast.error(
        `Recovery failed for ${agent.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  const isBusy = (id: string) =>
    (invokeMutation.variables?.id === id && invokeMutation.isPending) ||
    (recoverMutation.variables?.id === id && recoverMutation.isPending);

  const agents = agentsQuery.data ?? [];

  const columns = columnHelper.columns([
    columnHelper.accessor('name', {
      header: 'Name',
      cell: (info) => <span className="font-medium text-white">{info.getValue()}</span>,
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      cell: (info) => {
        const status = info.getValue() ?? 'unknown';
        return (
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusColor(status)}`} />
            <span className="capitalize text-white/70">{status}</span>
          </div>
        );
      },
    }),
    columnHelper.accessor('last_heartbeat', {
      header: 'Last Heartbeat',
      cell: (info) => (
        <span className="text-xs text-white/40">{relativeTime(info.getValue())}</span>
      ),
    }),
    columnHelper.accessor('capabilities', {
      header: 'Capabilities',
      cell: (info) => {
        const caps = info.getValue() ?? [];
        return (
          <div className="flex max-w-[260px] flex-wrap gap-1">
            {caps.slice(0, 3).map((cap) => (
              <Badge key={cap} className="border-white/10 bg-white/10 text-white/70">
                {cap}
              </Badge>
            ))}
            {caps.length > 3 ? (
              <Badge className="border-white/10 bg-white/10 text-white/40">
                +{caps.length - 3}
              </Badge>
            ) : null}
          </div>
        );
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      cell: (info) => {
        const agent = info.row.original;
        const busy = isBusy(agent.id);
        return (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              onClick={() => invokeMutation.mutate(agent)}
            >
              Invoke
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={() => recoverMutation.mutate(agent)}
            >
              Recover
            </Button>
          </div>
        );
      },
    }),
  ]);

  const table = useTable({ features, columns, data: agents });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Agent Fleet
          {agentsQuery.data ? (
            <span className="ml-2 text-sm font-normal text-white/40">
              {agentsQuery.data.length} registered
            </span>
          ) : null}
        </h2>
        <Button
          size="sm"
          variant="outline"
          disabled={agentsQuery.isFetching}
          className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          onClick={() => void agentsQuery.refetch()}
        >
          {agentsQuery.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {agentsQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full bg-white/10" />
          ))}
        </div>
      ) : agentsQuery.isError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-300">
            Failed to load agents: {agentsQuery.error.message}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 border-red-500/30 text-red-300 hover:bg-red-500/10 hover:text-red-200"
            onClick={() => void agentsQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
          No agents registered.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="border-white/10 hover:bg-transparent">
                  {group.headers.map((header) => (
                    <TableHead key={header.id} className="text-xs text-white/40">
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="border-white/5 hover:bg-white/5">
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
