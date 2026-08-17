'use client';

// ============================================================================
// Command Center — Sites panel
// ============================================================================
// Site monitor list (status, last check, response time, failures, enable
// switch), add / edit / delete monitor dialogs, "check all now", and a local
// deploy card. Everything goes through the ccFetch server-action bridge — no
// CRON_SECRET ever reaches the client.
// ============================================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, RefreshCw, Rocket, Trash2, WifiOff } from 'lucide-react';

import { ccFetch } from '@/app/command-center/actions';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  deploySummary,
  formatLastCheck,
  formatResponseTime,
  monitorIsDown,
  monitorStatusColor,
  type DeployLike,
  type MonitorLike,
} from '../sites-lib';

interface MonitorListResponse {
  monitors?: MonitorLike[];
  total?: number;
}

interface CheckAllResult {
  checked_at?: string;
  total?: number;
  up?: number;
  down?: number;
  errors?: number;
}

interface MonitorForm {
  name: string;
  url: string;
  check_interval_seconds: string;
  expected_status_code: string;
  timeout_ms: string;
  notify_on_down: boolean;
  notify_on_recovery: boolean;
}

const EMPTY_FORM: MonitorForm = {
  name: '',
  url: '',
  check_interval_seconds: '300',
  expected_status_code: '200',
  timeout_ms: '10000',
  notify_on_down: true,
  notify_on_recovery: true,
};

function formBody(form: MonitorForm): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    url: form.url.trim(),
    notify_on_down: form.notify_on_down,
    notify_on_recovery: form.notify_on_recovery,
  };
  const interval = Number(form.check_interval_seconds);
  if (form.check_interval_seconds.trim() !== '' && !Number.isNaN(interval)) {
    body.check_interval_seconds = interval;
  }
  const expected = Number(form.expected_status_code);
  if (form.expected_status_code.trim() !== '' && !Number.isNaN(expected)) {
    body.expected_status_code = expected;
  }
  const timeout = Number(form.timeout_ms);
  if (form.timeout_ms.trim() !== '' && !Number.isNaN(timeout)) {
    body.timeout_ms = timeout;
  }
  return body;
}

function toForm(m: MonitorLike): MonitorForm {
  return {
    name: m.name ?? '',
    url: m.url ?? '',
    check_interval_seconds: m.check_interval_seconds != null ? String(m.check_interval_seconds) : '300',
    expected_status_code: m.expected_status_code != null ? String(m.expected_status_code) : '200',
    timeout_ms: m.timeout_ms != null ? String(m.timeout_ms) : '10000',
    notify_on_down: m.notify_on_down ?? true,
    notify_on_recovery: m.notify_on_recovery ?? true,
  };
}

export default function SitesPanel() {
  const queryClient = useQueryClient();

  // ── Monitor list ───────────────────────────────────────────────────────────
  const monitorsQuery = useQuery({
    queryKey: ['command-center', 'monitors'],
    queryFn: async () => {
      const res = await ccFetch<MonitorListResponse>({
        endpoint: '/api/monitors',
        method: 'GET',
      });
      if (!res.ok) {
        throw new Error(res.error ?? 'Failed to load monitors');
      }
      return res.data?.monitors ?? [];
    },
  });

  // ── Toggle enable (optimistic) ────────────────────────────────────────────
  const toggleEnabled = useMutation({
    mutationFn: async ({ id, is_enabled }: { id: string; is_enabled: boolean }) => {
      const res = await ccFetch<{ ok?: boolean; monitor?: MonitorLike }>({
        endpoint: `/api/monitors/${id}`,
        method: 'PATCH',
        body: { is_enabled },
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to update monitor');
      return res.data?.monitor;
    },
    onMutate: async ({ id, is_enabled }) => {
      await queryClient.cancelQueries({ queryKey: ['command-center', 'monitors'] });
      const previous = queryClient.getQueryData<MonitorLike[]>(['command-center', 'monitors']);
      queryClient.setQueryData<MonitorLike[]>(['command-center', 'monitors'], (old) =>
        old?.map((m) => (m.id === id ? { ...m, is_enabled } : m)) ?? old,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['command-center', 'monitors'], context.previous);
      }
      toast.error(err instanceof Error ? err.message : 'Failed to update monitor');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['command-center', 'monitors'] });
    },
  });

  // ── Check all now ─────────────────────────────────────────────────────────
  const checkAll = useMutation({
    mutationFn: async () => {
      const res = await ccFetch<CheckAllResult>({
        endpoint: '/api/monitors/check',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? 'Check failed');
      return res.data;
    },
    onSuccess: (data) => {
      const total = data?.total ?? 0;
      const errors = data?.errors ?? 0;
      toast.success(
        `Checked ${total} site${total === 1 ? '' : 's'} — ${data?.up ?? 0} up, ${data?.down ?? 0} down${errors > 0 ? `, ${errors} errors` : ''}`,
      );
      queryClient.invalidateQueries({ queryKey: ['command-center', 'monitors'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Check failed');
    },
  });

  // ── Create / edit monitor dialogs ─────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MonitorForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const openCreate = () => {
    setFormMode('create');
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (m: MonitorLike) => {
    setFormMode('edit');
    setEditingId(m.id ?? null);
    setForm(toForm(m));
    setFormError(null);
    setFormOpen(true);
  };

  const saveMonitor = useMutation({
    mutationFn: async ({ id, body }: { id: string | null; body: Record<string, unknown> }) => {
      if (id) {
        const res = await ccFetch<{ ok?: boolean; monitor?: MonitorLike }>({
          endpoint: `/api/monitors/${id}`,
          method: 'PATCH',
          body,
        });
        if (!res.ok) {
          const msg = (res.data as { error?: string } | undefined)?.error ?? res.error;
          throw new Error(msg ?? 'Failed to update monitor');
        }
        return res.data?.monitor;
      }
      const res = await ccFetch<{ ok?: boolean; monitor?: MonitorLike }>({
        endpoint: '/api/monitors',
        method: 'POST',
        body,
      });
      if (!res.ok) {
        const msg = (res.data as { error?: string } | undefined)?.error ?? res.error;
        throw new Error(msg ?? 'Failed to create monitor');
      }
      return res.data?.monitor;
    },
    onSuccess: (_monitor, vars) => {
      toast.success(vars.id ? 'Monitor updated' : 'Monitor created');
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ['command-center', 'monitors'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save monitor');
    },
  });

  const handleSubmit = () => {
    if (!form.name.trim()) {
      setFormError('Name is required');
      return;
    }
    if (!form.url.trim()) {
      setFormError('URL is required');
      return;
    }
    setFormError(null);
    saveMonitor.mutate({ id: editingId, body: formBody(form) });
  };

  // ── Delete monitor ────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<MonitorLike | null>(null);
  const deleteMonitor = useMutation({
    mutationFn: async (id: string) => {
      const res = await ccFetch<{ ok?: boolean }>({
        endpoint: `/api/monitors/${id}`,
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to delete monitor');
    },
    onSuccess: () => {
      toast.success('Monitor deleted');
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['command-center', 'monitors'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete monitor');
    },
  });

  // ── Deploy ────────────────────────────────────────────────────────────────
  const [processName, setProcessName] = useState('');
  const [deployUrl, setDeployUrl] = useState('');
  const [deployResult, setDeployResult] = useState<DeployLike | null>(null);

  const deploy = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { kind: 'local' };
      if (processName.trim()) body.process = processName.trim();
      if (deployUrl.trim()) body.url = deployUrl.trim();
      const res = await ccFetch<{ ok?: boolean; result?: DeployLike }>({
        endpoint: '/api/command-center/deploy',
        method: 'POST',
        body,
      });
      const data = res.data as { ok?: boolean; result?: DeployLike; error?: string } | undefined;
      if (!res.ok && !data?.result) {
        throw new Error(data?.error ?? res.error ?? 'Deploy failed');
      }
      return data;
    },
    onSuccess: (data) => {
      const result = data?.result ?? null;
      setDeployResult(result);
      if (result) {
        if (result.ok) toast.success(deploySummary(result));
        else toast.error(deploySummary(result));
      }
    },
    onError: (err) => {
      setDeployResult(null);
      toast.error(err instanceof Error ? err.message : 'Deploy failed');
    },
  });

  const monitors = monitorsQuery.data ?? [];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Monitor list */}
      <Card className="border border-white/10 bg-white/5 text-white">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base text-white">Site Monitors</CardTitle>
              <CardDescription className="text-white/40">
                Uptime checks across the fleet. Monitors hit {monitors.length > 0 ? monitors.length : '…'} targets.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                onClick={() => checkAll.mutate()}
                disabled={checkAll.isPending}
              >
                {checkAll.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Check all now
              </Button>
              <Button
                className="bg-white text-black hover:bg-white/80"
                onClick={openCreate}
                disabled={saveMonitor.isPending}
              >
                <Plus className="size-4" />
                Add monitor
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {monitorsQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full bg-white/10" />
              ))}
            </div>
          ) : monitorsQuery.isError ? (
            <OfflineState
              message={monitorsQuery.error instanceof Error ? monitorsQuery.error.message : 'Failed to load monitors'}
              onRetry={() => queryClient.invalidateQueries({ queryKey: ['command-center', 'monitors'] })}
            />
          ) : monitors.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/40">
              No monitors configured yet. Add your first one to start tracking uptime.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 bg-white/5 hover:bg-white/5">
                    <TableHead className="text-xs uppercase tracking-wider text-white/40">Name</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-white/40">URL</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-white/40">Status</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-white/40">Last check</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-white/40">Response</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-white/40">Failures</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-white/40">Enabled</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wider text-white/40">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monitors.map((m) => (
                    <TableRow key={m.id ?? m.name} className="border-white/10 hover:bg-white/5">
                      <TableCell className="font-medium text-white">{m.name ?? '—'}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-white/40" title={m.url}>
                        {m.url ?? '—'}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs text-white">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${monitorStatusColor(m.current_status)}`} />
                          {monitorIsDown(m) ? 'down' : (m.current_status ?? 'unknown')}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-white/40">{formatLastCheck(m.last_check_at)}</TableCell>
                      <TableCell className="font-mono text-xs text-white/40">
                        {formatResponseTime(m.last_response_time_ms)}
                      </TableCell>
                      <TableCell>
                        <span className={m.consecutive_failures && m.consecutive_failures > 0 ? 'text-xs font-semibold text-red-400' : 'text-xs text-white/40'}>
                          {m.consecutive_failures ?? 0}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={m.is_enabled ?? false}
                          onCheckedChange={(checked) =>
                            m.id && toggleEnabled.mutate({ id: m.id, is_enabled: checked })
                          }
                          disabled={!m.id || toggleEnabled.isPending}
                          aria-label={`Enable ${m.name ?? 'monitor'}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-white/40 hover:text-white"
                            onClick={() => openEdit(m)}
                            aria-label={`Edit ${m.name ?? 'monitor'}`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-white/40 hover:text-red-400"
                            onClick={() => setDeleteTarget(m)}
                            aria-label={`Delete ${m.name ?? 'monitor'}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deploy */}
      <Card className="border border-white/10 bg-white/5 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Rocket className="size-4" />
            Deploy
          </CardTitle>
          <CardDescription className="text-white/40">
            Restart a local process (e.g. &ldquo;draymond&rdquo;) and smoke-test an optional URL. Requires pm2 on the host.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="deploy-process" className="text-xs text-white/40">
                Process name
              </label>
              <Input
                id="deploy-process"
                className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
                placeholder="draymond"
                value={processName}
                onChange={(e) => setProcessName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="deploy-url" className="text-xs text-white/40">
                URL to smoke-test (optional)
              </label>
              <Input
                id="deploy-url"
                className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
                placeholder="http://localhost:3444/health"
                value={deployUrl}
                onChange={(e) => setDeployUrl(e.target.value)}
              />
            </div>
          </div>
          <Button
            className="bg-white text-black hover:bg-white/80"
            disabled={deploy.isPending || (!processName.trim() && !deployUrl.trim())}
            onClick={() => deploy.mutate()}
          >
            {deploy.isPending ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            {deploy.isPending ? 'Deploying…' : 'Deploy'}
          </Button>
          {deploy.isPending && (
            <p className="text-xs text-white/40">Restarting process and smoke-testing — this can take up to a minute.</p>
          )}
          {deployResult && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                deployResult.ok
                  ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : 'border-red-500/30 bg-red-500/10 text-red-400'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{deployResult.ok ? 'Success' : 'Failed'}</span>
                <span className="font-mono text-white/40">
                  {deployResult.durationMs != null ? formatResponseTime(deployResult.durationMs) : ''}
                </span>
              </div>
              <p className="mt-1 break-words text-white/60">{deployResult.message ?? 'No message returned.'}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / edit monitor dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="border-white/10 bg-[#121212] text-white">
          <DialogHeader>
            <DialogTitle className="text-white">{formMode === 'create' ? 'Add monitor' : 'Edit monitor'}</DialogTitle>
            <DialogDescription className="text-white/40">
              {formMode === 'create'
                ? 'Track uptime for a new site or service.'
                : 'Update the monitor configuration.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="monitor-name" className="text-xs text-white/40">Name</label>
              <Input
                id="monitor-name"
                className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
                placeholder="Uplift Agent"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="monitor-url" className="text-xs text-white/40">URL</label>
              <Input
                id="monitor-url"
                className="border-white/10 bg-white/5 text-white placeholder:text-white/30"
                placeholder="http://localhost:8000/health"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <label htmlFor="monitor-interval" className="text-xs text-white/40">Interval (s)</label>
                <Input
                  id="monitor-interval"
                  type="number"
                  className="border-white/10 bg-white/5 text-white"
                  value={form.check_interval_seconds}
                  onChange={(e) => setForm({ ...form, check_interval_seconds: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="monitor-status-code" className="text-xs text-white/40">Status code</label>
                <Input
                  id="monitor-status-code"
                  type="number"
                  className="border-white/10 bg-white/5 text-white"
                  value={form.expected_status_code}
                  onChange={(e) => setForm({ ...form, expected_status_code: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="monitor-timeout" className="text-xs text-white/40">Timeout (ms)</label>
                <Input
                  id="monitor-timeout"
                  type="number"
                  className="border-white/10 bg-white/5 text-white"
                  value={form.timeout_ms}
                  onChange={(e) => setForm({ ...form, timeout_ms: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                <span className="text-xs text-white/60">Notify on down</span>
                <Switch
                  checked={form.notify_on_down}
                  onCheckedChange={(checked) => setForm({ ...form, notify_on_down: checked })}
                  aria-label="Notify on down"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                <span className="text-xs text-white/60">Notify on recovery</span>
                <Switch
                  checked={form.notify_on_recovery}
                  onCheckedChange={(checked) => setForm({ ...form, notify_on_recovery: checked })}
                  aria-label="Notify on recovery"
                />
              </div>
            </div>
            {formError && <p className="text-xs text-red-400">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button className="bg-white text-black hover:bg-white/80" onClick={handleSubmit} disabled={saveMonitor.isPending}>
              {saveMonitor.isPending && <Loader2 className="size-4 animate-spin" />}
              {formMode === 'create' ? 'Create monitor' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="border-white/10 bg-[#121212] text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Delete monitor?</DialogTitle>
            <DialogDescription className="text-white/40">
              Delete &ldquo;{deleteTarget?.name ?? 'monitor'}&rdquo;? This stops monitoring for that target and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="bg-red-500/20 text-red-400 hover:bg-red-500/30"
              disabled={deleteMonitor.isPending}
              onClick={() => deleteTarget?.id && deleteMonitor.mutate(deleteTarget.id)}
            >
              {deleteMonitor.isPending && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OfflineState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <WifiOff className="size-6 text-white/40" />
      <div>
        <p className="text-sm font-medium text-white">Could not reach the bridge</p>
        <p className="mt-1 max-w-sm text-xs text-white/40">{message}</p>
      </div>
      <Button variant="outline" className="border-white/10 bg-white/5 text-white hover:bg-white/10" onClick={onRetry}>
        <RefreshCw className="size-4" />
        Retry
      </Button>
    </div>
  );
}
