'use client';

import { useState, useTransition } from 'react';
import { updateWorkflow } from './actions';

const TRIGGER_OPTIONS = ['manual', 'scheduled', 'api', 'webhook'] as const;

export default function WorkflowControls({
  chainId,
  initialStatus,
  initialTrigger,
  initialName,
  initialDescription,
}: {
  chainId: string;
  initialStatus: string;
  initialTrigger: string;
  initialName: string;
  initialDescription: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [trigger, setTrigger] = useState(initialTrigger);
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function apply(payload: Parameters<typeof updateWorkflow>[1]) {
    if (isPending) return;
    setError(null);
    setSaved(null);
    startTransition(async () => {
      try {
        await updateWorkflow(chainId, payload);
        if (payload.status) setStatus(payload.status);
        if (payload.trigger_type) setTrigger(payload.trigger_type);
        setSaved('Saved');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save');
      }
    });
  }

  function handleSave() {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    apply({
      name,
      description,
      trigger_type: trigger,
      status,
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Quick status toggle */}
      <div className="flex shrink-0 gap-2">
        {status === 'active' ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => apply({ status: 'paused' })}
            className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/30 disabled:opacity-40"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => apply({ status: 'active' })}
            className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-[#22c55e]/20 hover:bg-[#22c55e]/30 text-[#22c55e] border border-[#22c55e]/30 disabled:opacity-40"
          >
            Activate
          </button>
        )}
        <button
          type="button"
          disabled={isPending}
          onClick={() => setEditing((v) => !v)}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white disabled:opacity-40"
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {editing && (
        <div className="w-full max-w-md rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div>
            <label className="block text-xs font-bold tracking-widest uppercase text-white/40 mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
            />
          </div>
          <div>
            <label className="block text-xs font-bold tracking-widest uppercase text-white/40 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold tracking-widest uppercase text-white/40 mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/60 [&>option]:bg-[#0a0a0f]"
              >
                {['draft', 'active', 'paused', 'archived'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold tracking-widest uppercase text-white/40 mb-1">
                Trigger
              </label>
              <select
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/60 [&>option]:bg-[#0a0a0f]"
              >
                {TRIGGER_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isPending}
              onClick={handleSave}
              className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-[#22c55e] hover:bg-[#16a34a] text-black disabled:opacity-40"
            >
              {isPending ? 'Saving...' : 'Save Changes'}
            </button>
            {saved && <span className="text-xs text-emerald-400">{saved}</span>}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
