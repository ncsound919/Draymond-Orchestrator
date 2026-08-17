'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, Link2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ccFetch } from '@/app/command-center/actions';
import {
  SEO_PRIORITIES,
  SEO_STATUSES,
  type SeoPriority,
  type SeoStatus,
  type SeoTask,
} from '@/lib/command-center/types';
import { priorityColor, seoFilter, type SeoFilter } from '../seo-lib';

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const FILTERS: { value: SeoFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
];

const STATUS_COLORS: Record<SeoStatus, string> = {
  todo: 'bg-white/10 text-white/50',
  in_progress: 'bg-blue-500/20 text-blue-400',
  blocked: 'bg-orange-500/20 text-orange-400',
  done: 'bg-green-500/20 text-green-400',
};

function formatDate(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type SeoFormBody = Record<string, unknown>;

interface SeoFormState {
  title: string;
  description: string;
  url: string;
  priority: SeoPriority;
  status: SeoStatus;
  owner: string;
  due: string;
}

function formFromTask(task: SeoTask | null): SeoFormState {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    url: task?.url ?? '',
    priority: task?.priority ?? 'medium',
    status: task?.status ?? 'todo',
    owner: task?.owner ?? '',
    due: task?.due_at ? task.due_at.slice(0, 10) : '',
  };
}

// ---------------------------------------------------------------------------
// Add / edit task dialog
// ---------------------------------------------------------------------------

function SeoTaskFormDialog({
  open,
  task,
  onOpenChange,
  onSave,
  pending,
}: {
  open: boolean;
  task: SeoTask | null;
  onOpenChange: (open: boolean) => void;
  onSave: (body: SeoFormBody) => void;
  pending: boolean;
}) {
  const [form, setForm] = useState<SeoFormState>(() => formFromTask(task));
  const set = (patch: Partial<SeoFormState>) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const body: SeoFormBody = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      url: form.url.trim() || null,
      priority: form.priority,
      status: form.status,
      owner: form.owner.trim() || null,
      due_at: form.due ? new Date(`${form.due}T00:00:00Z`).toISOString() : null,
    };
    onSave(body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'Add Task'}</DialogTitle>
          <DialogDescription>
            {task ? 'Update task details below.' : 'Create a new SEO task.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="task-title">
              Title *
            </label>
            <Input
              id="task-title"
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="Optimize meta descriptions"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="task-url">
              URL
            </label>
            <Input
              id="task-url"
              type="url"
              value={form.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://example.com/page"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="task-desc">
              Description
            </label>
            <textarea
              id="task-desc"
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="What needs to happen..."
              rows={2}
              className="h-auto w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-white placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus:outline-none dark:bg-input/30"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/60">Priority</label>
              <Select
                value={form.priority}
                onValueChange={(v) => set({ priority: (v ?? 'medium') as SeoPriority })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEO_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/60">Status</label>
              <Select
                value={form.status}
                onValueChange={(v) => set({ status: (v ?? 'todo') as SeoStatus })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEO_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="task-owner">
                Owner
              </label>
              <Input
                id="task-owner"
                value={form.owner}
                onChange={(e) => set({ owner: e.target.value })}
                placeholder="draymond"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="task-due">
                Due date
              </label>
              <Input
                id="task-due"
                type="date"
                value={form.due}
                onChange={(e) => set({ due: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !form.title.trim()}>
              {pending ? 'Saving...' : task ? 'Save Changes' : 'Add Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-8 bg-white/10" />
            <Skeleton className="h-4 flex-1 bg-white/5" />
            <Skeleton className="h-4 w-16 bg-white/10" />
            <Skeleton className="h-4 w-20 bg-white/10" />
            <Skeleton className="h-4 w-16 bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function SeoPanel() {
  const queryClient = useQueryClient();
  const queryKey = ['seo-tasks'];

  const [filter, setFilter] = useState<SeoFilter>('all');
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; task: SeoTask } | null>(
    null,
  );
  const [dialogNonce, setDialogNonce] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SeoTask | null>(null);

  const openCreate = () => {
    setDialog({ mode: 'create' });
    setDialogNonce((n) => n + 1);
  };
  const openEdit = (task: SeoTask) => {
    setDialog({ mode: 'edit', task });
    setDialogNonce((n) => n + 1);
  };

  const {
    data: tasks = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<SeoTask[]>({
    queryKey: queryKey,
    queryFn: async () => {
      const res = await ccFetch<{ tasks: SeoTask[] }>({
        endpoint: '/api/command-center/seo',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to load SEO tasks');
      return res.data?.tasks ?? [];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const res = await ccFetch<{ task: SeoTask }>({
        endpoint: '/api/command-center/seo',
        method: 'PATCH',
        body: { id, action: 'done', done },
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to update task');
      return res.data?.task;
    },
    onMutate: async ({ id, done }) => {
      await queryClient.cancelQueries({ queryKey: queryKey });
      const prev = queryClient.getQueryData<SeoTask[]>(queryKey);
      queryClient.setQueryData<SeoTask[]>(queryKey, (old) =>
        (old ?? []).map((t) =>
          t.id === id ? { ...t, is_done: done, status: done ? ('done' as const) : ('todo' as const) } : t,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast.error('Failed to update task');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKey }),
  });

  const createMutation = useMutation({
    mutationFn: async (body: SeoFormBody) => {
      const res = await ccFetch<{ task: SeoTask }>({
        endpoint: '/api/command-center/seo',
        method: 'POST',
        body,
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to create task');
      return res.data?.task;
    },
    onSuccess: () => {
      toast.success('Task added');
      queryClient.invalidateQueries({ queryKey: queryKey });
      setDialog(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: SeoFormBody }) => {
      const res = await ccFetch<{ task: SeoTask }>({
        endpoint: '/api/command-center/seo',
        method: 'PATCH',
        body: { id, ...body },
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to update task');
      return res.data?.task;
    },
    onSuccess: () => {
      toast.success('Task updated');
      queryClient.invalidateQueries({ queryKey: queryKey });
      setDialog(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await ccFetch<{ ok: boolean }>({
        endpoint: `/api/command-center/seo?id=${encodeURIComponent(id)}`,
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to delete task');
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKey });
      const prev = queryClient.getQueryData<SeoTask[]>(queryKey);
      queryClient.setQueryData<SeoTask[]>(queryKey, (old) =>
        (old ?? []).filter((t) => t.id !== id),
      );
      return { prev };
    },
    onSuccess: () => {
      toast.success('Task deleted');
      setDeleteTarget(null);
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast.error('Failed to delete task');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKey }),
  });

  const handleSave = (body: SeoFormBody) => {
    if (dialog?.mode === 'edit') {
      updateMutation.mutate({ id: dialog.task.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const total = tasks.length;
  const doneCount = tasks.filter((t) => t.is_done).length;
  const pending = total - doneCount;

  const byPriority = useMemo(() => {
    const map: Record<SeoPriority, number> = { low: 0, medium: 0, high: 0, urgent: 0 };
    for (const t of tasks) {
      if ((SEO_PRIORITIES as readonly string[]).includes(t.priority)) map[t.priority] += 1;
    }
    return map;
  }, [tasks]);

  const filtered = useMemo(() => seoFilter(tasks, filter), [tasks, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">SEO Task Feed</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-white/50">
              Total <span className="font-semibold text-white">{total}</span>
            </span>
            <span className="text-white/50">
              Done <span className="font-semibold text-emerald-400">{doneCount}</span>
            </span>
            <span className="text-white/50">
              Pending <span className="font-semibold text-yellow-400">{pending}</span>
            </span>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Add Task
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === f.value
                  ? 'text-white bg-white/10'
                  : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SEO_PRIORITIES.map((p) => (
            <span
              key={p}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${priorityColor(p)}`}
            >
              {p}
              <span className="opacity-70">{byPriority[p]}</span>
            </span>
          ))}
        </div>
      </div>

      {isLoading && <TableSkeleton />}

      {isError && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-sm text-white/60">Failed to load SEO tasks.</p>
          <Button variant="outline" className="mt-3" onClick={() => refetch()}>
            <RefreshCw />
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <Table>
            <TableHeader>
              <TableRow className="bg-white/5 text-white/40">
                <TableHead className="w-14 text-xs uppercase tracking-wider">Done</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Task</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Priority</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Owner</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Due</TableHead>
                <TableHead className="w-20 text-right text-xs uppercase tracking-wider">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-white/30">
                    No tasks match this filter.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((task) => (
                <TableRow key={task.id} className="hover:bg-white/5">
                  <TableCell>
                    <Switch
                      checked={task.is_done}
                      onCheckedChange={(c) => toggleMutation.mutate({ id: task.id, done: c })}
                    />
                  </TableCell>
                  <TableCell>
                    <p
                      className={`font-medium ${
                        task.is_done ? 'text-white/40 line-through' : 'text-white'
                      }`}
                    >
                      {task.title}
                    </p>
                    {task.url && (
                      <p className="flex max-w-md items-center gap-1 truncate text-xs text-white/30">
                        <Link2 className="size-3 shrink-0" />
                        {task.url}
                      </p>
                    )}
                    {task.description && (
                      <p className="mt-0.5 max-w-md truncate text-xs text-white/40">
                        {task.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${priorityColor(task.priority)}`}
                    >
                      {task.priority}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[task.status] ?? 'bg-white/10 text-white/50'}`}
                    >
                      {task.status.replace('_', ' ')}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-white/60">
                    {task.owner ?? <span className="text-white/30">--</span>}
                  </TableCell>
                  <TableCell className="text-sm text-white/60">
                    {task.due_at ? (
                      <span className="flex items-center gap-1">
                        <CalendarDays className="size-3" />
                        {formatDate(task.due_at)}
                      </span>
                    ) : (
                      <span className="text-white/30">--</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-white/40 hover:text-white"
                        onClick={() => openEdit(task)}
                      >
                        <Pencil />
                        <span className="sr-only">Edit {task.title}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-white/40 hover:text-red-400"
                        onClick={() => setDeleteTarget(task)}
                      >
                        <Trash2 />
                        <span className="sr-only">Delete {task.title}</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SeoTaskFormDialog
        key={`${dialog?.mode === 'edit' ? dialog.task.id : 'create'}-${dialogNonce}`}
        open={dialog !== null}
        task={dialog?.mode === 'edit' ? dialog.task : null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
        onSave={handleSave}
        pending={createMutation.isPending || updateMutation.isPending}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete task</DialogTitle>
            <DialogDescription>
              Delete {deleteTarget?.title}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
