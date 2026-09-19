'use client';

import { useState, useTransition, useEffect } from 'react';
import { useOrchestratorHealth } from '@/hooks/useOrchestratorHealth';
import { createScheduledJob, updateScheduledJob, toggleJob, removeJob, runScheduledJob, catchUpMissedJobs, runAllFailedJobs } from './actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JobRunStatus = 'never' | 'running' | 'success' | 'failed' | 'skipped' | 'recovered';
type JobType = 'chain' | 'health_check' | 'notification' | 'custom';

type Job = {
  id: string;
  name: string;
  description: string | null;
  cron_expression: string;
  job_type: JobType;
  job_config: Record<string, unknown>;
  is_enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_status: JobRunStatus;
  last_run_duration_ms: number | null;
  last_error: string | null;
  run_count: number;
  fail_count: number;
  created_at: string;
};

type ChainOption = { id: string; name: string; slug: string };
type CustomHandler = { handler: string; label: string; description: string };

interface Props {
  initialJobs: Job[];
  chainOptions: ChainOption[];
  customHandlers: CustomHandler[];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return 'Unknown';
  const diff = now - then;

  // Future dates
  if (diff < 0) {
    const abs = Math.abs(diff);
    if (abs < 60_000) return `in ${Math.floor(abs / 1000)}s`;
    if (abs < 3_600_000) return `in ${Math.floor(abs / 60_000)}m`;
    if (abs < 86_400_000) return `in ${Math.floor(abs / 3_600_000)}h`;
    return `in ${Math.floor(abs / 86_400_000)}d`;
  }

  // Past dates
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatCronHuman(cron: string): string {
  const map: Record<string, string> = {
    '* * * * *': 'Every minute',
    '*/5 * * * *': 'Every 5 min',
    '*/10 * * * *': 'Every 10 min',
    '*/15 * * * *': 'Every 15 min',
    '*/30 * * * *': 'Every 30 min',
    '0 * * * *': 'Every hour',
    '0 */2 * * *': 'Every 2 hours',
    '0 */4 * * *': 'Every 4 hours',
    '0 */6 * * *': 'Every 6 hours',
    '0 */8 * * *': 'Every 8 hours',
    '0 */12 * * *': 'Every 12 hours',
    '0 0 * * *': 'Daily at midnight',
    '0 8 * * *': 'Daily at 8:00 AM',
    '0 9 * * *': 'Daily at 9:00 AM',
    '0 12 * * *': 'Daily at noon',
    '0 18 * * *': 'Daily at 6:00 PM',
    '0 9 * * 1': 'Weekly on Monday 9 AM',
    '0 9 * * 1-5': 'Weekdays at 9 AM',
    '0 0 1 * *': 'Monthly on the 1st',
  };

  if (map[cron]) return map[cron];

  // Try to parse simple patterns
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dom, mon, dow] = parts;

  // */N * * * * → Every N min
  if (min.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${min.slice(2)} min`;
  }

  // 0 */N * * * → Every N hours
  if (min === '0' && hour.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${hour.slice(2)} hours`;
  }

  // 0 H * * * → Daily at H:00
  if (min === '0' && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    const h = parseInt(hour, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${display}:00 ${ampm}`;
  }

  // M H * * * → Daily at H:MM
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${display}:${m.toString().padStart(2, '0')} ${ampm}`;
  }

  return cron;
}

function handlerLabel(customHandlers: CustomHandler[], cfg: Record<string, unknown>): string {
  const h = cfg?.handler;
  if (typeof h !== 'string') return '—';
  const def = customHandlers.find((d) => d.handler === h);
  return def ? def.label : h;
}

// ---------------------------------------------------------------------------
// Status & type badge styles
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  success: 'bg-emerald-500/20 text-emerald-400',
  failed: 'bg-red-500/20 text-red-400',
  running: 'bg-blue-500/20 text-blue-400',
  never: 'bg-white/10 text-white/40',
  skipped: 'bg-yellow-500/20 text-yellow-400',
  recovered: 'bg-purple-500/20 text-purple-300',
};

const TYPE_STYLES: Record<string, string> = {
  chain: 'bg-purple-500/20 text-purple-400',
  health_check: 'bg-cyan-500/20 text-cyan-400',
  notification: 'bg-amber-500/20 text-amber-400',
  custom: 'bg-white/10 text-white/50',
};

// ---------------------------------------------------------------------------
// Cron preset buttons
// ---------------------------------------------------------------------------

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: 'Every 5 min', value: '*/5 * * * *' },
  { label: 'Every 15 min', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily 8am', value: '0 8 * * *' },
  { label: 'Weekly Monday', value: '0 9 * * 1' },
];

type FilterTab = 'all' | 'enabled' | 'disabled' | 'failed';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SchedulesDashboard({ initialJobs, chainOptions, customHandlers }: Props) {
  const health = useOrchestratorHealth();
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [batchPending, setBatchPending] = useState(false);
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [loadedAt, setLoadedAt] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');

  // Hydration-safe timestamp — only runs on client
  useEffect(() => {
     
    setLoadedAt(new Date().toISOString().replace('T', ' ').slice(0, 19));
  }, []);

  // Keep jobs in sync when server re-renders with fresh initialJobs
  useEffect(() => {
     
    setJobs(initialJobs);
  }, [initialJobs]);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [jobType, setJobType] = useState<JobType>('chain');
  const [chainSlug, setChainSlug] = useState(chainOptions[0]?.slug ?? '');
  const [customHandler, setCustomHandler] = useState('');
  const [cronExpression, setCronExpression] = useState('0 * * * *');
  const [isEnabled, setIsEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  function resetForm() {
    setName('');
    setDescription('');
    setJobType('chain');
    setChainSlug(chainOptions[0]?.slug ?? '');
    setCustomHandler('');
    setCronExpression('0 * * * *');
    setIsEnabled(true);
    setFormError(null);
    setEditingJob(null);
  }

  function openCreate() {
    setEditingJob(null);
    resetForm();
    setShowForm(true);
  }

  function openEdit(job: Job) {
    setEditingJob(job);
    setName(job.name);
    setDescription(job.description ?? '');
    setJobType(job.job_type);
    const cfg = job.job_config ?? {};
    setChainSlug(typeof cfg.chain_slug === 'string' ? cfg.chain_slug : chainOptions[0]?.slug ?? '');
    setCustomHandler(typeof cfg.handler === 'string' ? cfg.handler : '');
    setCronExpression(job.cron_expression);
    setIsEnabled(job.is_enabled);
    setFormError(null);
    setShowForm(true);
  }

  function buildConfig(): Record<string, unknown> {
    const jobConfig: Record<string, unknown> = {};
    if (jobType === 'chain' && chainSlug) {
      jobConfig.chain_slug = chainSlug;
    }
    if (jobType === 'custom' && customHandler) {
      jobConfig.handler = customHandler;
      // Preserve any extra keys already on the job when editing.
      if (editingJob?.job_config && typeof editingJob.job_config === 'object') {
        for (const [k, v] of Object.entries(editingJob.job_config)) {
          if (k !== 'handler' && k !== 'chain_slug') jobConfig[k] = v;
        }
      }
    }
    return jobConfig;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Name is required');
      return;
    }
    if (!cronExpression.trim()) {
      setFormError('Cron expression is required');
      return;
    }
    if (jobType === 'chain' && !chainSlug) {
      setFormError('A chain template is required for chain jobs');
      return;
    }

    setFormError(null);
    startTransition(async () => {
      try {
        if (editingJob) {
          await updateScheduledJob(editingJob.id, {
            name: name.trim(),
            description: description.trim() || undefined,
            cron_expression: cronExpression.trim(),
            job_type: jobType,
            job_config: buildConfig(),
            is_enabled: isEnabled,
          });
        } else {
          await createScheduledJob({
            name: name.trim(),
            description: description.trim() || undefined,
            cron_expression: cronExpression.trim(),
            job_type: jobType,
            job_config: buildConfig(),
            is_enabled: isEnabled,
          });
        }
        resetForm();
        setShowForm(false);
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to save job');
      }
    });
  }

  function handleToggle(id: string, currentEnabled: boolean) {
    setActionError(null);
    setRunResult(null);
    setPendingJobId(id);
    startTransition(async () => {
      try {
        await toggleJob(id, !currentEnabled);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to toggle job');
      } finally {
        setPendingJobId(null);
      }
    });
  }

  function handleDelete(id: string, jobName: string) {
    if (!confirm(`Delete scheduled job "${jobName}"? This cannot be undone.`)) return;
    setActionError(null);
    setPendingJobId(id);
    startTransition(async () => {
      try {
        await removeJob(id);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to delete job');
      } finally {
        setPendingJobId(null);
      }
    });
  }

  function handleRunNow(id: string, jobName: string) {
    setActionError(null);
    setRunResult(null);
    setPendingJobId(id);
    startTransition(async () => {
      try {
        const result = await runScheduledJob(id);
        if (result.status === 'success') {
          setRunResult(`"${jobName}" completed in ${result.duration_ms}ms`);
        } else {
          setRunResult(`"${jobName}" FAILED: ${result.error ?? 'unknown error'}`);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to run job');
      } finally {
        setPendingJobId(null);
      }
    });
  }

  function handleCatchUp() {
    setActionError(null);
    setBatchResult(null);
    setBatchPending(true);
    startTransition(async () => {
      try {
        const r = await catchUpMissedJobs();
        setBatchResult(
          `Catch-up: ${r.processed} processed — ${r.ran} ran, ${r.failed} failed, ${r.skipped} skipped`
        );
        if (r.failed > 0) {
          const failed = r.results.filter((x) => x.status === 'failed').slice(0, 3);
          setBatchResult((prev) => prev + `\n${failed.map((f) => `• ${f.job_name}: ${f.error}`).join('\n')}`);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to catch up missed jobs');
      } finally {
        setBatchPending(false);
      }
    });
  }

  function handleRunAllFailed() {
    setActionError(null);
    setBatchResult(null);
    setBatchPending(true);
    startTransition(async () => {
      try {
        const r = await runAllFailedJobs();
        setBatchResult(
          `Re-run failed: ${r.attempted} attempted — ${r.ran} passed, ${r.failed} still failing`
        );
        if (r.failed > 0) {
          const failed = r.results.filter((x) => x.status === 'failed').slice(0, 3);
          setBatchResult((prev) => prev + `\n${failed.map((f) => `• ${f.job_name}: ${f.error}`).join('\n')}`);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to re-run failed jobs');
      } finally {
        setBatchPending(false);
      }
    });
  }

  const filteredJobs = jobs.filter((j) => {
    if (filter === 'enabled') return j.is_enabled;
    if (filter === 'disabled') return !j.is_enabled;
    if (filter === 'failed') return j.last_run_status === 'failed';
    return true;
  });

  const counts = {
    all: jobs.length,
    enabled: jobs.filter((j) => j.is_enabled).length,
    disabled: jobs.filter((j) => !j.is_enabled).length,
    failed: jobs.filter((j) => j.last_run_status === 'failed').length,
  };

  const inputCls =
    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-[#22c55e]/50 focus:border-[#22c55e]/50';

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">
      {/* -- Header ---------------------------------------------------- */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Schedules</h1>
          <p className="mt-1 text-sm text-white/40">
            {jobs.length} scheduled job{jobs.length !== 1 ? 's' : ''} · ordered by next run
          </p>
        </div>
        <button
          onClick={() => {
            if (showForm && !editingJob) {
              resetForm();
              setShowForm(false);
              return;
            }
            openCreate();
          }}
          aria-expanded={showForm}
          className="rounded-lg px-4 py-2 bg-[#22c55e] hover:bg-[#16a34a] text-black text-sm font-semibold transition-colors"
        >
          {showForm && !editingJob ? 'Cancel' : '+ New Job'}
        </button>
      </div>

      {/* -- Fleet controls ----------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white/5 border border-white/10 p-4">
        <div className="flex items-center gap-2 text-sm">
          <span
            role="status"
            className={`inline-flex h-2 w-2 rounded-full ${
              health === 'online' ? 'bg-[#22c55e]' : health === 'offline' ? 'bg-red-500' : 'bg-gray-500'
            }`}
          />
          <span className="text-white/70">
            {health === 'online' ? 'Draymond online' : health === 'offline' ? 'Draymond unreachable' : 'Checking Draymond…'}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCatchUp}
            disabled={batchPending}
            className="rounded-lg px-4 py-2 bg-[#22c55e]/15 hover:bg-[#22c55e]/25 border border-[#22c55e]/30 text-emerald-300 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Run jobs whose scheduled slot was missed while the server was down (last 24h)"
          >
            {batchPending ? 'Running…' : 'Catch up missed'}
          </button>
          <button
            type="button"
            onClick={handleRunAllFailed}
            disabled={batchPending || counts.failed === 0}
            className="rounded-lg px-4 py-2 bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Re-run every job whose last run failed"
          >
            {batchPending ? 'Running…' : `Re-run failed (${counts.failed})`}
          </button>
        </div>
      </div>

      {/* -- Filter tabs ----------------------------------------------- */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'enabled', 'disabled', 'failed'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setFilter(tab)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors ${
              filter === tab
                ? 'bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/30'
                : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            {tab} ({counts[tab]})
          </button>
        ))}
      </div>

      {/* -- New / Edit Job Form -------------------------------------- */}
      {showForm && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-5">
          <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">
            {editingJob ? `Edit Job — ${editingJob.name}` : 'Create Scheduled Job'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Row 1: Name + Job Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Daily health check"
                  required
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">
                  Job Type
                </label>
                <select
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value as JobType)}
                  className={inputCls + ' [&>option]:bg-[#1a1a2e] [&>option]:text-white'}
                >
                  <option value="chain">Chain (workflow)</option>
                  <option value="custom">Custom (built-in routine)</option>
                  <option value="health_check">Health Check</option>
                  <option value="notification">Notification</option>
                </select>
              </div>
            </div>

            {/* Chain selector (conditional) */}
            {jobType === 'chain' && (
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">
                  Chain Template
                </label>
                <select
                  value={chainSlug}
                  onChange={(e) => setChainSlug(e.target.value)}
                  className={inputCls + ' [&>option]:bg-[#1a1a2e] [&>option]:text-white'}
                >
                  {chainOptions.length === 0 && <option value="">No chains registered</option>}
                  {chainOptions.map((c) => (
                    <option key={c.id} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Custom handler picker (conditional) */}
            {jobType === 'custom' && (
              <div>
                <label className="block text-xs font-medium text-white/60 mb-1">
                  Routine (handler)
                </label>
                <select
                  value={customHandler}
                  onChange={(e) => setCustomHandler(e.target.value)}
                  className={inputCls + ' [&>option]:bg-[#1a1a2e] [&>option]:text-white'}
                >
                  <option value="">Select a routine...</option>
                  {customHandlers.map((h) => (
                    <option key={h.handler} value={h.handler}>
                      {h.label}
                    </option>
                  ))}
                </select>
                {customHandler && (
                  <p className="mt-1 text-xs text-white/40">
                    {customHandlers.find((h) => h.handler === customHandler)?.description}
                  </p>
                )}
                {customHandler === '' && editingJob && (
                  <p className="mt-1 text-xs text-white/30">
                    Existing config handler: {String((editingJob.job_config as Record<string, unknown>)?.handler ?? '—')}
                  </p>
                )}
              </div>
            )}

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description of this scheduled job"
                rows={2}
                className={inputCls + ' resize-none'}
              />
            </div>

            {/* Cron expression + presets */}
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1">
                Cron Expression *
              </label>
              <input
                type="text"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                placeholder="0 * * * *"
                required
                className={inputCls + ' font-mono'}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {CRON_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setCronExpression(preset.value)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      cronExpression === preset.value
                        ? 'bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/30'
                        : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 hover:text-white/70'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-white/30">
                {formatCronHuman(cronExpression)}
              </p>
            </div>

            {/* Enable toggle + submit */}
            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  onClick={() => setIsEnabled((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    isEnabled ? 'bg-[#22c55e]' : 'bg-white/20'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      isEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
                <span className="text-sm text-white/60">
                  {isEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>

              <div className="flex gap-2">
                {editingJob && (
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setShowForm(false);
                    }}
                    className="rounded-lg px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg px-4 py-2 bg-[#22c55e] hover:bg-[#16a34a] disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors"
                >
                  {isPending ? 'Saving...' : editingJob ? 'Save Changes' : 'Create Job'}
                </button>
              </div>
            </div>

            {formError && (
              <p className="text-sm text-red-400">{formError}</p>
            )}
          </form>
        </div>
      )}

      {/* -- Action Error / Result Banner ------------------------------ */}
      {actionError && (
        <div role="alert" className="rounded-xl bg-red-500/10 border border-red-500/20 px-5 py-3 flex items-center justify-between">
          <p className="text-sm text-red-400">{actionError}</p>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-red-400/60 hover:text-red-400 text-xs ml-4"
          >
            Dismiss
          </button>
        </div>
      )}
      {runResult && (
        <div role="status" aria-live="polite" className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-5 py-3 flex items-center justify-between">
          <p className="text-sm text-emerald-400 font-mono">{runResult}</p>
          <button
            type="button"
            onClick={() => setRunResult(null)}
            className="text-emerald-400/60 hover:text-emerald-400 text-xs ml-4"
          >
            Dismiss
          </button>
        </div>
      )}
      {batchResult && (
        <div role="status" aria-live="polite" className="rounded-xl bg-cyan-500/10 border border-cyan-500/20 px-5 py-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-cyan-300 font-mono whitespace-pre-line">{batchResult}</p>
            <button
              type="button"
              onClick={() => setBatchResult(null)}
              className="text-cyan-400/60 hover:text-cyan-400 text-xs ml-4 shrink-0"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* -- Job List -------------------------------------------------- */}
      <section>
        <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">
          {filter === 'all' ? 'All Jobs' : `${filter} (${counts[filter]})`}
        </h2>

        {filteredJobs.length === 0 ? (
          <div className="rounded-xl bg-white/5 border border-white/10 p-10 text-center">
            <p className="text-white/40 text-sm">
              {jobs.length === 0 ? 'No scheduled jobs yet.' : `No jobs match "${filter}".`}
            </p>
            <p className="text-white/20 text-xs mt-1">
              {jobs.length === 0 ? 'Create one to start automating workflows.' : 'Try a different filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-white/5 border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/40 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3 text-left font-medium" scope="col">Name</th>
                  <th className="px-5 py-3 text-left font-medium" scope="col">Schedule</th>
                  <th className="px-5 py-3 text-left font-medium" scope="col">Type</th>
                  <th className="px-5 py-3 text-left font-medium" scope="col">Status</th>
                  <th className="px-5 py-3 text-left font-medium" scope="col">Next Run</th>
                  <th className="px-5 py-3 text-right font-medium" scope="col">Runs</th>
                  <th className="px-5 py-3 text-right font-medium" scope="col">Fails</th>
                  <th className="px-5 py-3 text-center font-medium" scope="col">Enabled</th>
                  <th className="px-5 py-3 text-right font-medium" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredJobs.map((job) => {
                  const cfg = (job.job_config ?? {}) as Record<string, unknown>;
                  const handler = typeof cfg.handler === 'string' ? cfg.handler : null;
                  return (
                    <tr
                      key={job.id}
                      className={`transition-colors ${job.last_run_status === 'failed' ? 'bg-red-500/[0.03]' : 'hover:bg-white/[0.02]'}`}
                    >
                      {/* Name */}
                      <td className="px-5 py-3">
                        <div>
                          <span className="font-semibold text-white">{job.name}</span>
                          {job.description && (
                            <p className="text-xs text-white/30 mt-0.5 max-w-[200px] truncate">
                              {job.description}
                            </p>
                          )}
                          {handler && (
                            <p className="text-xs text-cyan-400/70 mt-0.5 font-mono truncate max-w-[220px]">
                              {handlerLabel(customHandlers, cfg)}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Cron */}
                      <td className="px-5 py-3">
                        <div>
                          <code className="font-mono text-xs text-white/40">
                            {job.cron_expression}
                          </code>
                          <p className="text-xs text-white/20 mt-0.5">
                            {formatCronHuman(job.cron_expression)}
                          </p>
                        </div>
                      </td>

                      {/* Job type */}
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            TYPE_STYLES[job.job_type] ?? TYPE_STYLES.custom
                          }`}
                        >
                          {job.job_type.replace('_', ' ')}
                        </span>
                      </td>

                      {/* Last run status */}
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            STATUS_STYLES[job.last_run_status] ?? STATUS_STYLES.never
                          }`}
                        >
                          {job.last_run_status}
                        </span>
                        {job.last_run_at && (
                          <p className="text-xs text-white/20 mt-0.5">
                            {formatRelativeTime(job.last_run_at)}
                          </p>
                        )}
                        {(job.last_run_status === 'failed' || job.last_run_status === 'skipped') && job.last_error && (
                          <p className="text-xs text-red-400/70 mt-0.5 truncate max-w-[220px]" title={job.last_error}>
                            {job.last_error}
                          </p>
                        )}
                      </td>

                      {/* Next run */}
                      <td className="px-5 py-3 text-xs text-white/50">
                        {job.is_enabled && job.next_run_at
                          ? formatRelativeTime(job.next_run_at)
                          : '--'}
                      </td>

                      {/* Run count */}
                      <td className="px-5 py-3 text-right font-mono text-xs text-white/50">
                        {job.run_count}
                      </td>

                      {/* Fail count */}
                      <td className="px-5 py-3 text-right font-mono text-xs">
                        <span className={job.fail_count > 0 ? 'text-red-400' : 'text-white/30'}>
                          {job.fail_count}
                        </span>
                      </td>

                      {/* Enable toggle */}
                      <td className="px-5 py-3 text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={job.is_enabled}
                          disabled={pendingJobId === job.id}
                          onClick={() => handleToggle(job.id, job.is_enabled)}
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                            job.is_enabled ? 'bg-[#22c55e]' : 'bg-white/20'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                              job.is_enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                            }`}
                          />
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={pendingJobId === job.id || !job.is_enabled}
                            onClick={() => handleRunNow(job.id, job.name)}
                            title={job.is_enabled ? 'Run this job now' : 'Enable the job first'}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-emerald-400/80 hover:text-emerald-400 hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Run
                          </button>
                          <button
                            type="button"
                            disabled={pendingJobId === job.id}
                            onClick={() => openEdit(job)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-white/50 hover:text-white hover:bg-white/10 border border-transparent hover:border-white/20 transition-colors disabled:opacity-40"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={pendingJobId === job.id}
                            onClick={() => handleDelete(job.id, job.name)}
                            className="rounded-md px-2.5 py-1 text-xs font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors disabled:opacity-40"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* -- Footer ---------------------------------------------------- */}
      <div className="border-t border-white/5 pt-6 pb-4">
        <p className="text-xs text-white/20 text-center">
          Draymond Scheduler &mdash; Last loaded:{' '}
          {loadedAt || '...'} UTC
        </p>
      </div>
    </div>
  );
}
