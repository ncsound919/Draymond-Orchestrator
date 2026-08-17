'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { Building2, MessageSquarePlus, Plus, RefreshCw, Trash2, User } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { ccFetch } from '@/app/command-center/actions';
import { LEAD_STAGES, type CommandLead, type LeadStage } from '@/lib/command-center/types';
import { formatCents, leadStageCount, pipelineValue } from '../crm-lib';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeadFormState {
  name: string;
  email: string;
  phone: string;
  company: string;
  value: string;
  stage: LeadStage;
  owner: string;
  source: string;
}

type LeadFormBody = Record<string, unknown>;

function formFromLead(lead: CommandLead | null): LeadFormState {
  return {
    name: lead?.name ?? '',
    email: lead?.email ?? '',
    phone: lead?.phone ?? '',
    company: lead?.company ?? '',
    value:
      lead && typeof lead.value_cents === 'number' && Number.isFinite(lead.value_cents) && lead.value_cents !== 0
        ? String(lead.value_cents / 100)
        : '',
    stage: lead?.stage ?? 'new',
    owner: lead?.owner ?? '',
    source: lead?.source ?? '',
  };
}

// ---------------------------------------------------------------------------
// Kanban column
// ---------------------------------------------------------------------------

function KanbanColumn({
  stage,
  leads,
  onEdit,
  onDelete,
  onNote,
}: {
  stage: LeadStage;
  leads: CommandLead[];
  onEdit: (lead: CommandLead) => void;
  onDelete: (lead: CommandLead) => void;
  onNote: (leadId: string, text: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const count = leadStageCount(leads, stage);

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl border border-white/10 bg-white/5 transition-colors ${
        isOver ? 'border-cyan-400/40 bg-white/10' : ''
      }`}
    >
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-white/70">
          {stage}
        </span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">{count}</span>
      </div>
      <div className="flex min-h-[140px] flex-col gap-2 p-2">
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onEdit={onEdit}
              onDelete={onDelete}
              onNote={onNote}
            />
          ))}
        </SortableContext>
        {leads.length === 0 && (
          <p className="py-6 text-center text-xs text-white/30">No leads</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lead card
// ---------------------------------------------------------------------------

function LeadCard({
  lead,
  onEdit,
  onDelete,
  onNote,
}: {
  lead: CommandLead;
  onEdit: (lead: CommandLead) => void;
  onDelete: (lead: CommandLead) => void;
  onNote: (leadId: string, text: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  });
  const [note, setNote] = useState('');

  const style = { transform: CSS.Transform.toString(transform), transition };

  const submitNote = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = note.trim();
    if (!text) return;
    onNote(lead.id, text);
    setNote('');
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (!isDragging) onEdit(lead);
      }}
      className={`group cursor-grab rounded-lg border border-white/10 bg-white/5 p-3 transition-colors hover:border-white/20 hover:bg-white/10 active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{lead.name}</p>
          {lead.company && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-white/40">
              <Building2 className="size-3 shrink-0" />
              {lead.company}
            </p>
          )}
        </div>
        <span className="shrink-0 text-sm font-semibold text-emerald-400">
          {formatCents(lead.value_cents)}
        </span>
      </div>

      {(lead.owner || lead.source) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
          {lead.owner && (
            <span className="flex items-center gap-1">
              <User className="size-3" />
              {lead.owner}
            </span>
          )}
          {lead.source && <span>{lead.source}</span>}
        </div>
      )}

      {lead.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {lead.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="bg-white/5 text-white/60">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submitNote} className="flex flex-1 items-center gap-1">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add note..."
            className="h-7 w-full min-w-0 rounded-md border border-white/10 bg-transparent px-2 text-xs text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
          />
          <Button type="submit" variant="ghost" size="icon-sm" className="text-white/50 hover:text-white">
            <MessageSquarePlus />
            <span className="sr-only">Add note</span>
          </Button>
        </form>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-white/40 hover:text-red-400"
          onClick={() => onDelete(lead)}
        >
          <Trash2 />
          <span className="sr-only">Delete {lead.name}</span>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / edit lead dialog
// ---------------------------------------------------------------------------

function LeadFormDialog({
  open,
  lead,
  onOpenChange,
  onSave,
  pending,
}: {
  open: boolean;
  lead: CommandLead | null;
  onOpenChange: (open: boolean) => void;
  onSave: (body: LeadFormBody) => void;
  pending: boolean;
}) {
  const [form, setForm] = useState<LeadFormState>(() => formFromLead(lead));
  const set = (patch: Partial<LeadFormState>) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const parsed = Number.parseFloat(form.value.trim());
    const valueCents = Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
    onSave({
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      company: form.company.trim() || null,
      owner: form.owner.trim() || null,
      source: form.source.trim() || null,
      stage: form.stage,
      ...(valueCents !== null ? { value_cents: valueCents } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{lead ? 'Edit Lead' : 'Add Lead'}</DialogTitle>
          <DialogDescription>
            {lead ? 'Update lead details below.' : 'Capture a new pipeline lead.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="lead-name">
              Name *
            </label>
            <Input
              id="lead-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Jane Doe"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="lead-email">
                Email
              </label>
              <Input
                id="lead-email"
                type="email"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="jane@acme.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="lead-phone">
                Phone
              </label>
              <Input
                id="lead-phone"
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
                placeholder="555-0100"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="lead-company">
                Company
              </label>
              <Input
                id="lead-company"
                value={form.company}
                onChange={(e) => set({ company: e.target.value })}
                placeholder="Acme Corp"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="lead-value">
                Value (USD)
              </label>
              <Input
                id="lead-value"
                inputMode="decimal"
                value={form.value}
                onChange={(e) => set({ value: e.target.value })}
                placeholder="5000"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="lead-owner">
                Owner
              </label>
              <Input
                id="lead-owner"
                value={form.owner}
                onChange={(e) => set({ owner: e.target.value })}
                placeholder="draymond"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="lead-source">
                Source
              </label>
              <Input
                id="lead-source"
                value={form.source}
                onChange={(e) => set({ source: e.target.value })}
                placeholder="outbound"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/60">Stage</label>
            <Select
              value={form.stage}
              onValueChange={(v) => set({ stage: (v ?? 'new') as LeadStage })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Button type="submit" disabled={pending || !form.name.trim()}>
              {pending ? 'Saving...' : lead ? 'Save Changes' : 'Add Lead'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Board skeleton
// ---------------------------------------------------------------------------

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {LEAD_STAGES.map((stage) => (
        <div
          key={stage}
          className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-2"
        >
          <div className="flex items-center justify-between px-1 py-1">
            <Skeleton className="h-3 w-16 bg-white/10" />
            <Skeleton className="h-4 w-6 bg-white/10" />
          </div>
          <Skeleton className="h-20 w-full bg-white/5" />
          <Skeleton className="h-20 w-full bg-white/5" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function CrmPanel() {
  const queryClient = useQueryClient();
  const queryKey = ['leads'];

  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; lead: CommandLead } | null>(
    null,
  );
  const [dialogNonce, setDialogNonce] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<CommandLead | null>(null);

  const openCreate = () => {
    setDialog({ mode: 'create' });
    setDialogNonce((n) => n + 1);
  };
  const openEdit = (lead: CommandLead) => {
    setDialog({ mode: 'edit', lead });
    setDialogNonce((n) => n + 1);
  };

  const {
    data: leads = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<CommandLead[]>({
    queryKey: queryKey,
    queryFn: async () => {
      const res = await ccFetch<{ leads: CommandLead[] }>({
        endpoint: '/api/command-center/crm',
        method: 'GET',
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to load leads');
      return res.data?.leads ?? [];
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const moveMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: LeadStage }) => {
      const res = await ccFetch<{ lead: CommandLead }>({
        endpoint: '/api/command-center/crm',
        method: 'PATCH',
        body: { id, action: 'move', stage },
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to move lead');
      return res.data?.lead;
    },
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey: queryKey });
      const prev = queryClient.getQueryData<CommandLead[]>(queryKey);
      queryClient.setQueryData<CommandLead[]>(queryKey, (old) =>
        (old ?? []).map((l) => (l.id === id ? { ...l, stage } : l)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast.error('Failed to move lead');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKey }),
  });

  const createMutation = useMutation({
    mutationFn: async (body: LeadFormBody) => {
      const res = await ccFetch<{ lead: CommandLead }>({
        endpoint: '/api/command-center/crm',
        method: 'POST',
        body,
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to create lead');
      return res.data?.lead;
    },
    onSuccess: () => {
      toast.success('Lead added');
      queryClient.invalidateQueries({ queryKey: queryKey });
      setDialog(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: LeadFormBody }) => {
      const res = await ccFetch<{ lead: CommandLead }>({
        endpoint: '/api/command-center/crm',
        method: 'PATCH',
        body: { id, ...body },
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to update lead');
      return res.data?.lead;
    },
    onSuccess: () => {
      toast.success('Lead updated');
      queryClient.invalidateQueries({ queryKey: queryKey });
      setDialog(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const noteMutation = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const res = await ccFetch<{ lead: CommandLead }>({
        endpoint: '/api/command-center/crm',
        method: 'PATCH',
        body: { id, action: 'note', text, by: 'operator' },
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to add note');
      return res.data?.lead;
    },
    onSuccess: () => {
      toast.success('Note added');
      queryClient.invalidateQueries({ queryKey: queryKey });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await ccFetch<{ ok: boolean }>({
        endpoint: `/api/command-center/crm?id=${encodeURIComponent(id)}`,
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(res.error ?? 'Failed to delete lead');
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKey });
      const prev = queryClient.getQueryData<CommandLead[]>(queryKey);
      queryClient.setQueryData<CommandLead[]>(queryKey, (old) =>
        (old ?? []).filter((l) => l.id !== id),
      );
      return { prev };
    },
    onSuccess: () => {
      toast.success('Lead deleted');
      setDeleteTarget(null);
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      toast.error('Failed to delete lead');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKey }),
  });

  const handleSave = (body: LeadFormBody) => {
    if (dialog?.mode === 'edit') {
      updateMutation.mutate({ id: dialog.lead.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const leadId = String(active.id);
    const targetId = String(over.id);
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    let targetStage: LeadStage | undefined;
    if ((LEAD_STAGES as readonly string[]).includes(targetId)) {
      targetStage = targetId as LeadStage;
    } else {
      targetStage = leads.find((l) => l.id === targetId)?.stage;
    }
    if (!targetStage || targetStage === lead.stage) return;
    moveMutation.mutate({ id: leadId, stage: targetStage });
  };

  const byStage = useMemo(() => {
    const map: Record<LeadStage, CommandLead[]> = {
      new: [],
      contacted: [],
      qualified: [],
      proposal: [],
      won: [],
      lost: [],
    };
    for (const lead of leads) {
      if (lead.stage in map) map[lead.stage].push(lead);
    }
    return map;
  }, [leads]);

  const activeValue = pipelineValue(leads);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">CRM Pipeline</h2>
          <p className="mt-0.5 text-sm text-white/40">
            Pipeline value:{' '}
            <span className="font-medium text-emerald-400">{formatCents(activeValue)}</span>
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus />
          Add Lead
        </Button>
      </div>

      {isLoading && <BoardSkeleton />}

      {isError && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-sm text-white/60">Failed to load leads.</p>
          <Button variant="outline" className="mt-3" onClick={() => refetch()}>
            <RefreshCw />
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-3">
            {LEAD_STAGES.map((stage) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                leads={byStage[stage]}
                onEdit={openEdit}
                onDelete={(lead) => setDeleteTarget(lead)}
                onNote={(id, text) => noteMutation.mutate({ id, text })}
              />
            ))}
          </div>
        </DndContext>
      )}

      <LeadFormDialog
        key={`${dialog?.mode === 'edit' ? dialog.lead.id : 'create'}-${dialogNonce}`}
        open={dialog !== null}
        lead={dialog?.mode === 'edit' ? dialog.lead : null}
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
            <DialogTitle>Delete lead</DialogTitle>
            <DialogDescription>
              Delete {deleteTarget?.name}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteMutation.isPending}>
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
