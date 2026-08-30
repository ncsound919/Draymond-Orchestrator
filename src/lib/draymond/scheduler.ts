// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Autonomous Scheduler / Cron Service
// ============================================================================
// Manages scheduled jobs stored in `draymond_scheduled_jobs`. Parses cron
// expressions, determines which jobs are due, executes them (chains, health
// checks, notifications, or custom handlers), and records results.
// ============================================================================

import { createDraymondAdminClient } from './client';
import { instantiateChain, executeChain } from './chains';
import { checkAllAgentHealth } from './index';
import { sendNotification, sendAlertEmail } from './notifications';
import { emitJobStarted, emitJobCompleted, emitJobFailed } from '@/lib/draymond/event-bridge';
import { delegationTimeoutSeconds, delegationFor, isWithinWindow, delegationWindow } from './delegation';
import { classifyRetryable, retryDelayMs } from './retry';
import type { BbtechInsightSyncResult } from '@/lib/science/trendsFeed';
import type { DrainResult as GapDrainResult } from '@/lib/science/researchEscalation';

// ============================================================================
// RUN LEASES + HEARTBEAT
// ============================================================================
// A claimed run gets a lease (`lease_expires_at`). The executing process
// heartbeats the lease so slow-but-alive runs are never treated as crashed.
// Only a lease that has actually expired (process died mid-run) is recovered —
// the fixed 45-minute threshold is the fallback for legacy rows that predate
// the lease column. Recovered runs are marked `recovered`, NOT `failed`, so a
// crashed process doesn't manufacture a kairos failure storm.
// ============================================================================

/** Lease duration (ms). Tune via DRAYMOND_JOB_LEASE_MS. Default 10 minutes. */
function leaseExpiryMs(): number {
  const raw = Number(process.env.DRAYMOND_JOB_LEASE_MS ?? 10 * 60 * 1000);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000;
}

/** ISO timestamp marking when a lease claimed at `now` will expire. */
function leaseExpiryIso(now: Date): string {
  return new Date(now.getTime() + leaseExpiryMs()).toISOString();
}

/** Refresh a job's lease so a long-running job is not misread as crashed. */
async function refreshJobLease(jobId: string): Promise<void> {
  const supabase = createDraymondAdminClient();
  await supabase
    .from('draymond_scheduled_jobs')
    .update({ lease_expires_at: new Date(Date.now() + leaseExpiryMs()).toISOString() })
    .eq('id', jobId);
}

/** Start a heartbeat that refreshes the job lease; returns a stop() handle. */
function startJobHeartbeat(jobId: string): () => void {
  const intervalMs = Math.max(10_000, Math.min(60_000, Math.floor(leaseExpiryMs() / 4)));
  const timer = setInterval(() => {
    refreshJobLease(jobId).catch(() => {});
  }, intervalMs);
  return () => clearInterval(timer);
}

/**
 * True when a running row is actually dead. Prefers the lease column; falls
 * back to the legacy `last_run_at` threshold for rows that predate it.
 */
export function isStaleLease(
  leaseExpiresAt: string | null | undefined,
  lastActivityAt: string | null,
  nowMs: number,
  legacyThresholdMs: number
): boolean {
  if (leaseExpiresAt) {
    const t = new Date(leaseExpiresAt).getTime();
    if (Number.isFinite(t)) return t < nowMs;
  }
  // Legacy fallback: no lease → use last activity + threshold.
  if (lastActivityAt) {
    const t = new Date(lastActivityAt).getTime();
    if (Number.isFinite(t)) return t < nowMs - legacyThresholdMs;
  }
  return true; // no timestamps at all — treat as dead
}

// ============================================================================
// DELEGATION WINDOW GATE
// ============================================================================
// A custom job whose handler has a delegation-plan window only executes inside
// that window. When a due job fires outside its window (e.g. the R&D night job
// reaching its slot during the day) it is deferred — rescheduled to its next
// real slot without burning tokens.
// ============================================================================

/** True when a due job should be deferred because its delegation window is closed. */
function isOutsideDelegationWindow(job: ScheduledJob, now: Date): boolean {
  if (job.job_type !== 'custom') return false;
  const handler = job.job_config?.handler;
  if (typeof handler !== 'string') return false;
  const spec = delegationFor(handler);
  if (!spec) return false; // unplanned handlers run as scheduled
  return !isWithinWindow(spec, now);
}

/** Human-readable window label for skip reasons (defaults to the phase window). */
function delegationWindowLabel(job: ScheduledJob): string {
  const handler = job.job_config?.handler;
  if (typeof handler !== 'string') return 'unplanned';
  const window = delegationWindow(handler);
  return `${window.start}-${window.end}`;
}

// ============================================================================
// TYPES
// ============================================================================

export type JobType = 'chain' | 'health_check' | 'notification' | 'decay_sweep' | 'custom';

export type JobRunStatus = 'never' | 'running' | 'success' | 'failed' | 'skipped' | 'recovered';

export interface ScheduledJob {
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
  max_retries: number;
  timeout_seconds: number;
  notify_on_failure: boolean;
  notify_on_success: boolean;
  /** When a run is claimed: the instant the running lease expires (crashed-run detection). */
  lease_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduledJobInsert {
  name: string;
  description?: string;
  cron_expression: string;
  job_type: JobType;
  job_config?: Record<string, unknown>;
  is_enabled?: boolean;
  next_run_at?: string;
  max_retries?: number;
  timeout_seconds?: number;
  notify_on_failure?: boolean;
  notify_on_success?: boolean;
}

export interface ScheduledJobUpdate {
  name?: string;
  description?: string;
  cron_expression?: string;
  job_type?: JobType;
  job_config?: Record<string, unknown>;
  is_enabled?: boolean;
  next_run_at?: string;
  max_retries?: number;
  timeout_seconds?: number;
  notify_on_failure?: boolean;
  notify_on_success?: boolean;
}

export interface JobListFilters {
  is_enabled?: boolean;
  job_type?: JobType;
  last_run_status?: JobRunStatus;
  limit?: number;
  /** Sort column (defaults to next_run_at). */
  order_by?: 'next_run_at' | 'created_at' | 'name' | 'last_run_at';
  /** Ascending sort (defaults to true). */
  ascending?: boolean;
}

export interface JobRunResult {
  job_id: string;
  job_name: string;
  job_type: JobType;
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  error?: string;
  output?: unknown;
}

// ============================================================================
// CRON EXPRESSION PARSER
// ============================================================================

/**
 * Parse a single cron field value and return whether the given value matches.
 *
 * Supports:
 *  - `*`         — any value
 *  - `5`         — exact value
 *  - `1-5`       — range (inclusive)
 *  - `1,3,5`     — list
 *  - `* /5`      — interval (every N, written without the space)
 *  - `1-30/5`    — range with interval
 */
function matchesCronField(field: string, value: number, min: number, max: number): boolean {
  // Handle lists first (may contain ranges/intervals)
  if (field.includes(',')) {
    return field.split(',').some((part) => matchesCronField(part.trim(), value, min, max));
  }

  // Handle interval: */N or M-N/S
  if (field.includes('/')) {
    const [rangePart, stepStr] = field.split('/');
    const step = parseInt(stepStr, 10);
    if (isNaN(step) || step <= 0) return false;

    let rangeMin = min;
    let rangeMax = max;

    if (rangePart !== '*') {
      if (rangePart.includes('-')) {
        const [lo, hi] = rangePart.split('-').map(Number);
        rangeMin = lo;
        rangeMax = hi;
      } else {
        rangeMin = parseInt(rangePart, 10);
      }
    }

    if (value < rangeMin || value > rangeMax) return false;
    return (value - rangeMin) % step === 0;
  }

  // Handle range: M-N
  if (field.includes('-')) {
    const [lo, hi] = field.split('-').map(Number);
    return value >= lo && value <= hi;
  }

  // Wildcard
  if (field === '*') return true;

  // Exact value
  return parseInt(field, 10) === value;
}

/**
 * Calculate the next run time for a 5-field cron expression after the given date.
 *
 * Fields: minute hour day-of-month month day-of-week
 *   - minute:       0–59
 *   - hour:         0–23
 *   - day-of-month: 1–31
 *   - month:        1–12
 *   - day-of-week:  0–6 (0 = Sunday)
 *
 * Walks forward minute-by-minute from `after` (default: now) until a matching
 * time is found. Caps the search at 366 days to prevent infinite loops on
 * impossible expressions.
 */
export function getNextRunTime(cronExpr: string, after?: Date): Date {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression "${cronExpr}": expected 5 fields (minute hour day month weekday), got ${fields.length}`
    );
  }

  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;

  // Start one minute after the reference time
  const cursor = new Date(after ?? new Date());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  // Safety limit: don't search beyond 366 days
  const maxIterations = 366 * 24 * 60;

  for (let i = 0; i < maxIterations; i++) {
    const minute = cursor.getMinutes();
    const hour = cursor.getHours();
    const day = cursor.getDate();
    const month = cursor.getMonth() + 1; // JS months are 0-indexed
    const weekday = cursor.getDay();      // 0 = Sunday

    if (
      matchesCronField(minuteField, minute, 0, 59) &&
      matchesCronField(hourField, hour, 0, 23) &&
      matchesCronField(dayField, day, 1, 31) &&
      matchesCronField(monthField, month, 1, 12) &&
      matchesCronField(weekdayField, weekday, 0, 6)
    ) {
      return cursor;
    }

    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  throw new Error(
    `Could not find next run time for cron expression "${cronExpr}" within 366 days`
  );
}

// ============================================================================
// JOB CRUD
// ============================================================================

/** List scheduled jobs with optional filters. Defaults to next-run order so the
 * schedule list reads chronologically (what fires next is at the top) instead
 * of the old created_at-DESC pile that made schedules look unordered. */
export async function listJobs(filters?: JobListFilters): Promise<ScheduledJob[]> {
  const supabase = createDraymondAdminClient();
  const limit = Math.min(Math.max(filters?.limit ?? 200, 1), 200);
  const orderBy = filters?.order_by ?? 'next_run_at';
  const ascending = filters?.ascending ?? true;

  let query = supabase
    .from('draymond_scheduled_jobs')
    .select('*')
    .order(orderBy, { ascending })
    .limit(limit);

  if (filters?.is_enabled !== undefined) query = query.eq('is_enabled', filters.is_enabled);
  if (filters?.job_type) query = query.eq('job_type', filters.job_type);
  if (filters?.last_run_status) query = query.eq('last_run_status', filters.last_run_status);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list scheduled jobs: ${error.message}`);
  return (data ?? []) as ScheduledJob[];
}

/** Get a single scheduled job by name or UUID. */
export async function getJob(nameOrId: string): Promise<ScheduledJob | null> {
  const supabase = createDraymondAdminClient();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);

  const { data, error } = await supabase
    .from('draymond_scheduled_jobs')
    .select('*')
    .eq(isUuid ? 'id' : 'name', nameOrId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch job: ${error.message}`);
  }

  return (data as ScheduledJob) ?? null;
}

/** Create a new scheduled job. Automatically computes `next_run_at` if not provided. */
export async function createJob(input: ScheduledJobInsert): Promise<ScheduledJob> {
  const supabase = createDraymondAdminClient();

  const nextRun = input.next_run_at ?? getNextRunTime(input.cron_expression).toISOString();

  // Custom handlers inherit their max duration from the delegation plan so the
  // scheduler and the day orchestration agree on how long a task may run.
  const handler =
    input.job_type === 'custom' && typeof input.job_config?.handler === 'string'
      ? input.job_config.handler
      : undefined;
  const delegationTimeout = handler ? delegationTimeoutSeconds(handler) : undefined;
  const timeoutSeconds = input.timeout_seconds ?? delegationTimeout ?? 300;

  const { data, error } = await supabase
    .from('draymond_scheduled_jobs')
    .insert({
      name: input.name,
      description: input.description ?? null,
      cron_expression: input.cron_expression,
      job_type: input.job_type,
      job_config: input.job_config ?? {},
      is_enabled: input.is_enabled ?? true,
      next_run_at: nextRun,
      max_retries: input.max_retries ?? 1,
      timeout_seconds: timeoutSeconds,
      notify_on_failure: input.notify_on_failure ?? true,
      notify_on_success: input.notify_on_success ?? false,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create scheduled job "${input.name}": ${error.message}`);
  return data as ScheduledJob;
}

/** Update an existing scheduled job. Recomputes `next_run_at` if cron changes. */
export async function updateJob(id: string, updates: ScheduledJobUpdate): Promise<ScheduledJob> {
  const supabase = createDraymondAdminClient();

  // If the cron expression changed and no explicit next_run_at was provided, recompute
  const payload: Record<string, unknown> = { ...updates };
  if (updates.cron_expression && !updates.next_run_at) {
    payload.next_run_at = getNextRunTime(updates.cron_expression).toISOString();
  }

  const { data, error } = await supabase
    .from('draymond_scheduled_jobs')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update job ${id}: ${error.message}`);
  return data as ScheduledJob;
}

/** Delete a scheduled job by ID. */
export async function deleteJob(id: string): Promise<void> {
  const supabase = createDraymondAdminClient();

  const { error } = await supabase
    .from('draymond_scheduled_jobs')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`Failed to delete job ${id}: ${error.message}`);
}

/** Enable a scheduled job and recompute its next run time. */
export async function enableJob(id: string): Promise<ScheduledJob> {
  const supabase = createDraymondAdminClient();

  // Fetch the current cron expression to recompute next_run_at
  const { data: existing, error: fetchError } = await supabase
    .from('draymond_scheduled_jobs')
    .select('cron_expression')
    .eq('id', id)
    .single();

  if (fetchError || !existing) {
    throw new Error(`Job ${id} not found: ${fetchError?.message ?? 'no data'}`);
  }

  const nextRun = getNextRunTime((existing as { cron_expression: string }).cron_expression).toISOString();

  const { data, error } = await supabase
    .from('draymond_scheduled_jobs')
    .update({ is_enabled: true, next_run_at: nextRun })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to enable job ${id}: ${error.message}`);
  return data as ScheduledJob;
}

/** Disable a scheduled job. */
export async function disableJob(id: string): Promise<ScheduledJob> {
  const supabase = createDraymondAdminClient();

  const { data, error } = await supabase
    .from('draymond_scheduled_jobs')
    .update({ is_enabled: false })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to disable job ${id}: ${error.message}`);
  return data as ScheduledJob;
}

/**
 * Run a job NOW regardless of its schedule (the "Run Now" button). Claims the
 * job atomically, executes its handler, records the run metadata, and returns
 * the outcome. Does NOT advance next_run_at (the next scheduled slot stays).
 */
export async function runJobNow(id: string): Promise<JobRunResult> {
  const supabase = createDraymondAdminClient();

  const job = await getJob(id);
  if (!job) throw new Error(`Job ${id} not found`);
  if (!job.is_enabled) {
    throw new Error(`Job "${job.name}" is disabled — enable it first (Run Now respects the schedule).`);
  }

  // Atomic claim so a concurrent tick doesn't double-run.
  const claimNow = new Date();
  const { data: claimed, error: claimError } = await supabase
    .from('draymond_scheduled_jobs')
    .update({ last_run_status: 'running', lease_expires_at: leaseExpiryIso(claimNow) })
    .eq('id', job.id)
    .neq('last_run_status', 'running')
    .select('id')
    .maybeSingle();
  if (claimError) throw new Error(`Failed to claim job "${job.name}": ${claimError.message}`);
  if (!claimed) {
    throw new Error(`Job "${job.name}" is already running.`);
  }

  const startTime = Date.now();
  const now = new Date();
  const stopHeartbeat = startJobHeartbeat(job.id);
  emitJobStarted(job.id, job.name, job.job_type);

  try {
    const output = await executeJobByType(job);
    const durationMs = Date.now() - startTime;
    stopHeartbeat();
    await supabase
      .from('draymond_scheduled_jobs')
      .update({
        last_run_at: now.toISOString(),
        last_run_status: 'success',
        last_run_duration_ms: durationMs,
        last_error: null,
        lease_expires_at: null,
        run_count: job.run_count + 1,
      })
      .eq('id', job.id);
    emitJobCompleted(job.id, job.name, job.job_type, durationMs);
    return { job_id: job.id, job_name: job.name, job_type: job.job_type, status: 'success', duration_ms: durationMs, output };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    stopHeartbeat();
    await supabase
      .from('draymond_scheduled_jobs')
      .update({
        last_run_at: now.toISOString(),
        last_run_status: 'failed',
        last_run_duration_ms: durationMs,
        last_error: errorMessage,
        lease_expires_at: null,
        run_count: job.run_count + 1,
        fail_count: job.fail_count + 1,
      })
      .eq('id', job.id);
    emitJobFailed(job.id, job.name, job.job_type, errorMessage);
    return { job_id: job.id, job_name: job.name, job_type: job.job_type, status: 'failed', duration_ms: durationMs, error: errorMessage };
  }
}

// ============================================================================
// IN-PROCESS SCHEDULER TICK
// ============================================================================
// The scheduler previously ONLY ran when something external hit GET /api/cron.
// If that trigger fires rarely (e.g. once at 6am) then runDueJobs() executes
// EVERY overdue job in one burst — the "night recap at 6am" problem. This tick
// runs runDueJobs() every minute inside the server process so each job fires at
// its real scheduled minute. A single-flight lock prevents overlapping ticks.
// ============================================================================

const TICK_INTERVAL_MS = Number(process.env.DRAYMOND_SCHEDULER_TICK_MS ?? 60_000);

let _tickTimer: ReturnType<typeof setInterval> | null = null;
let _tickRunning = false;
/** Max how late a job may be before it is SKIPPED (not run late) and rescheduled. */
const CATCH_UP_GRACE_MS = Number(process.env.DRAYMOND_CRON_GRACE_MS ?? 15 * 60 * 1000);
/** How far back the boot catch-up pass will reach for jobs missed while the
 * server was down. Jobs overdue beyond this horizon are rescheduled (not run). */
const BOOT_CATCHUP_HORIZON_MS = Number(
  process.env.DRAYMOND_BOOT_CATCHUP_HORIZON_MS ?? 24 * 60 * 60 * 1000
);

/**
 * Start the in-process scheduler loop (idempotent). Called from
 * instrumentation.ts at server startup.
 *
 * On boot it also fires a one-shot catch-up pass so jobs that were missed while
 * the server was offline actually RUN (within the horizon) instead of being
 * silently skipped as "Missed window" — when Draymond starts, the work begins.
 */
export function startInProcessScheduler(): void {
  if (_tickTimer) return; // already running

  // Boot catch-up: execute enabled jobs whose slot was missed while the server
  // was off, so overnight/downtime work is not lost. Best-effort and bounded by
  // the horizon so a 2-week outage doesn't replay ancient slots.
  if (BOOT_CATCHUP_HORIZON_MS > 0) {
    void runDueJobs(new Date(), { catchupMs: BOOT_CATCHUP_HORIZON_MS })
      .then((results) => {
        const ran = results.filter((r) => r.status === 'success').length;
        const failed = results.filter((r) => r.status === 'failed').length;
        if (results.length > 0) {
          console.log(
            `[Draymond Scheduler] boot catch-up: ${results.length} missed job(s) processed (${ran} ok, ${failed} failed)`
          );
        }
      })
      .catch((err) => {
        console.error(`[Draymond Scheduler] boot catch-up failed: ${err instanceof Error ? err.message : err}`);
      });
  }

  _tickTimer = setInterval(() => {
    if (_tickRunning) return; // single-flight — never overlap
    _tickRunning = true;
    runDueJobs()
      .catch((err) => {
        console.error(`[Draymond Scheduler] in-process tick failed: ${err instanceof Error ? err.message : err}`);
      })
      .finally(() => {
        _tickRunning = false;
      });
  }, TICK_INTERVAL_MS);
  // unref() so the timer never keeps the process alive by itself.
  _tickTimer.unref?.();
}

/** Stop the in-process scheduler loop (tests / teardown). */
export function stopInProcessScheduler(): void {
  if (_tickTimer) {
    clearInterval(_tickTimer);
    _tickTimer = null;
  }
}

/** True while a tick is running (tests). */
export function isSchedulerTickRunning(): boolean {
  return _tickRunning;
}

// ============================================================================
// JOB EXECUTION ENGINE
// ============================================================================

const NOTIFICATION_RECIPIENT = process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER ?? '';

// ============================================================================
// KNOWN CUSTOM HANDLERS — dropdown registry for the Schedules UI
// ============================================================================
// A `custom` job's job_config.handler selects which built-in routine runs.
// This table is the source of truth the UI renders as a picker, so operators
// never have to type a raw handler string (and can't typo it). When a handler
// is missing here it still runs (executeJobByType), but the UI shows it as an
// "advanced/custom" free-text field.
// ============================================================================

export interface CustomHandlerDef {
  handler: string;
  label: string;
  description: string;
}

export const CUSTOM_HANDLERS: CustomHandlerDef[] = [
  { handler: 'brain_decision_cycle', label: 'Brain Decision Cycle', description: 'Consult the deterministic brain reasoning engine and route hiccups to the repair/coding teams.' },
  { handler: 'agent_heartbeat_sweep', label: 'Agent Heartbeat Sweep', description: 'Ping every roster service health endpoint and record real liveness.' },
  { handler: 'service_health_repair', label: 'Service Health Repair', description: 'Probe ecosystem services and auto-start any that are down.' },
  { handler: 'self_repair_check', label: 'Self-Repair Check', description: 'Failure scan + safe auto-repairs; escalate unknowns to on-call.' },
  { handler: 'repair_failed_jobs', label: 'Repair Team (failed jobs)', description: 'Scan failed jobs and deploy coding/skill agents to repair them.' },
  { handler: 'kairos_scan', label: 'Kairos Scan', description: 'Proactive fleet scan: down monitors, failed jobs, stale leads, revenue shortfall.' },
  { handler: 'treasury_pulse', label: 'Treasurer Cash Pulse', description: 'Pull settled Stripe charges and update revenue to date.' },
  { handler: 'phase_recap', label: 'Phase Recap (workplace)', description: 'Build + save + send a day-phase recap (email + Open-Chat).' },
  { handler: 'evening_call_recap', label: 'Evening Call Recap', description: 'Open-Chat calls you with the day summary via ntfy.' },
  { handler: 'ingest_news', label: 'News Digest Ingest', description: 'Ingest news APIs and cache current items for the fleet.' },
  { handler: 'self_learning_loop', label: 'Self-Learning Loop', description: 'Distill lessons from outcomes (QA/jobs/incidents).' },
  { handler: 'synthesis_midday', label: 'Synthesis Midday Check', description: 'Midday synthesis pass: evaluate sector thresholds and run synthesis for sectors ready to study combinations.' },
  { handler: 'clinvar_surveillance', label: 'ClinVar Variant Surveillance', description: 'Query real NCBI ClinVar (via BioComposable) for watched variants and flag reclassifications.' },
  { handler: 'rd_night', label: 'Night Mode R&D', description: 'Overnight research + dev planning from news + backlog.' },
  { handler: 'fetch_market_data', label: 'Market Data Snapshot', description: 'Daily free-API market/research snapshot.' },
  { handler: 'rotate_tokens', label: 'Token Rotation Check', description: 'Report provider budget/rate health for key rotation.' },
  { handler: 'api_key_audit', label: 'Free-API Key Audit', description: 'Audit which free-API keys are configured.' },
  { handler: 'benchmark_roster', label: 'Roster Benchmark', description: 'Deep-score pictured agents repos and queue the weakest.' },
  { handler: 'benchmark_entities', label: 'Benchmark: Entities', description: 'Run a benchmark cycle over entities.' },
  { handler: 'benchmark_sites', label: 'Benchmark: Sites', description: 'Run a benchmark cycle over sites.' },
  { handler: 'benchmark_crons', label: 'Benchmark: Crons', description: 'Run a benchmark cycle over crons.' },
  { handler: 'benchmark_chains', label: 'Benchmark: Chains', description: 'Run a benchmark cycle over chains.' },
  { handler: 'run_overlay_qa', label: 'Overlay365 QA', description: 'Playwright QA pass across Overlay365 sites.' },
  { handler: 'scan_book_library', label: 'Book Library Scan', description: 'Auto-ingest new books from the library folders.' },
  { handler: 'publish_social_queue', label: 'Social Publish Drainer', description: 'Drain the SMD publish queue to X/LinkedIn (deterministic publisher).' },
  { handler: 'wiki_sync', label: 'Brain Wiki Sync', description: 'Sync the deterministic-brain wiki into the cache.' },
  { handler: 'file_share_check', label: 'Overlay File Share Test', description: 'Exercise the file-sharing / browser-fetch surface.' },
  { handler: 'code_review_check', label: 'Overlay Code Review Scan', description: 'Exercise the local deep-analysis code-review scorer.' },
  { handler: 'editorial_push', label: 'Editorial Morning Push', description: 'Push morning editorial articles to Sports Steve.' },
  { handler: 'systemic_consolidate', label: 'Systemic Consolidation', description: 'Consolidate lessons, persist memory, align agenda goals.' },
  { handler: 'systemic_interconnect', label: 'Systemic Interconnect', description: 'Full one-shot: seed agenda + knowledge graph + consolidate.' },
  { handler: 'dispatch_worker_tasks', label: 'On-Device Ops Dispatch', description: 'Dispatch marketing/social/email tasks to remote workers.' },
  { handler: 'mission_pipeline_sync', label: 'Mission Pipeline Sync', description: 'Reconcile opportunity stages, flag stale leads, compute KPIs.' },
  { handler: 'mission_strategy_review', label: 'Mission Strategy Review', description: 'Pipeline + revenue vs target, emailed memo.' },
  { handler: 'mission_run_maas_cycle', label: 'MaaS Monthly Cycle', description: 'Run the MaaS delivery chain for each active client.' },
  { handler: 'dream_cycle', label: 'Dream Cycle', description: 'AutoDream 4-phase memory consolidation (self-gated).' },
  { handler: 'ultraplan_process', label: 'Ultraplan Process', description: 'Drain the deep-planning queue.' },
  { handler: 'research_rotation', label: 'Research Rotation', description: 'Drain the highest-priority ready science experiment from the queue.' },
  { handler: 'science_campaign_seed', label: 'Science Campaign Seed', description: 'Re-seed the science/sports experiment backlog from real datasets + papers when the queue runs low.' },
  { handler: 'benchmark_discovery_loop', label: 'Benchmark Olympics Discovery Loop', description: 'Autonomous research loop: probe the fleet, mature discovery hypotheses, surface quick-upgrade insights, and auto-fix weak components via the repair team.' },
  { handler: 'repair_shift', label: 'Daily Repair Shift', description: 'Daily fleet shift: code-review audit -> repair/upgrade ecosystem components -> benchmark improvements -> self-learning optimization.' },
  { handler: 'research_grade_loop', label: 'Research Breakthrough Grading', description: 'Grade CureMind/BB-Tech research output for breakthrough potential, feed trends/insights/discoveries + self-learning.' },
  { handler: 'science_paper_refresh', label: 'Science Paper Refresh', description: 'Refresh the OpenAlex/PubMed literature cache for every active science goal.' },
  { handler: 'science_publication_loop', label: 'Science Publication Loop', description: 'Publish frontier/promising graded discoveries to Overlay Global Lens + drain publication→self-learning.' },
  { handler: 'nba_stats_ingest', label: 'NBA Stats Ingest', description: 'Run the sports_science metrics pipeline over NBA dataset profiles + optional live game-log fetch.' },
  { handler: 'bankroll_pulse', label: 'Sports Bankroll Pulse', description: 'Surface Sports Steve bankroll/P&L/bets into Draymond state.' },
  { handler: 'finance_strategy_brief', label: 'Finance Strategy Brief', description: 'Pull the finance-connect daily strategy brief for the treasurer/strategist.' },
  { handler: 'finance_goals_sync', label: 'Finance Goals Sync', description: 'Sync capability-grounded finance goals into draymond_goals.' },
  { handler: 'wf_mission_sync', label: 'Mission Workflow Sync', description: 'Daily mission pipeline + revenue-vs-target sync (the 09:30 agenda step).' },
  {
    handler: 'commission_payout',
    label: 'Staffing Commission Payout',
    description: 'Run weekly commission payout: find all eligible accrued commissions (settled, 7+ days, active agents), create Stripe Connect transfers, update payout records. Fires every Friday at 09:00.',
  },
];

/**
 * Get the notification recipient at call time (avoids stale module-level reads in edge runtimes).
 */
function getNotificationRecipient(): string {
  return process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER ?? NOTIFICATION_RECIPIENT;
}

/**
 * Execute a single job based on its type and config.
 * Returns the output on success or throws on failure.
 */
async function executeJobByType(job: ScheduledJob): Promise<unknown> {
  const config = job.job_config;

  switch (job.job_type) {
    case 'chain': {
      const chainSlug = config.chain_slug as string;
      if (!chainSlug) throw new Error('chain job missing job_config.chain_slug');

      const input = (config.input as Record<string, unknown>) ?? {};
      const agentId = config.agent_id as string | undefined;

      // Instantiate and execute the chain
      const instance = await instantiateChain(chainSlug, input, undefined, agentId);
      const result = await executeChain(instance.id, agentId);

      // executeChain returns the execution context even when steps fail — it
      // does not throw. Derive the outcome from the recorded step statuses so
      // a job whose chain failed doesn't report "success".
      const stepResults = Object.values(result.steps ?? {});
      const failedSteps = stepResults.filter(
        (s) => s.status === 'failed' || s.status === 'blocked' || s.status === 'retrying'
      ).length;
      const completedSteps = stepResults.filter((s) => s.status === 'completed').length;
      if (failedSteps > 0) {
        const firstError = stepResults.find((s) => s.status === 'failed')?.error;
        throw new Error(
          `Chain "${chainSlug}" failed: ${failedSteps}/${stepResults.length} steps failed` +
          (firstError ? ` (${firstError.slice(0, 200)})` : '')
        );
      }
      return {
        ...result,
        summary: { totalSteps: stepResults.length, completedSteps, failedSteps: 0 },
      };
    }

    case 'health_check': {
      const reports = await checkAllAgentHealth();
      return reports;
    }

    case 'notification': {
      // Normalise both seed shapes: new nested `payload.type` and the legacy
      // flat `type` (pre-payload Daily Health Digest rows in live DBs).
      const rawPayload = (config.payload ?? {}) as Record<string, unknown>;
      const payload = {
        ...rawPayload,
        ...(config.type !== undefined && rawPayload.type === undefined ? { type: config.type as string } : {}),
      } as {
        channel?: string;
        recipient?: string;
        subject?: string;
        body?: string;
        type?: string;
        priority?: string;
      };

      // Special-case the Daily Health Digest: type 'health_summary' with no
      // explicit payload builds the digest from the live dashboard summary.
      if (payload?.type === 'health_summary' && !payload.recipient) {
        const { getDashboardSummary } = await import('./index');
        const { sendHealthDigest } = await import('./notifications');
        const recipient = getNotificationRecipient();
        if (!recipient) {
          throw new Error('Daily Health Digest requires DRAYMOND_ALERT_EMAIL or GMAIL_USER');
        }
        const summary = await getDashboardSummary();
        const record = await sendHealthDigest(recipient, summary);
        return { notification_id: record.id, sent_at: record.sent_at };
      }

      if (!payload || !payload.recipient || !payload.subject || !payload.body) {
        throw new Error('notification job missing required job_config.payload (recipient, subject, body)');
      }

      const result = await sendNotification({
        channel: (payload.channel as 'email') ?? 'email',
        recipient: payload.recipient,
        subject: payload.subject,
        body: payload.body,
        type: (payload.type as 'custom') ?? 'custom',
        priority: (payload.priority as 'normal') ?? 'normal',
      });
      return { notification_id: result.id, sent_at: result.sent_at };
    }

    case 'decay_sweep': {
      // Lazy import to avoid circular dependencies
      const { runDecaySweep } = await import('./memory-intelligence');
      const sweepResult = await runDecaySweep();
      console.log(
        `[Draymond Scheduler] Memory decay sweep: ${sweepResult.decayed} decayed, ` +
        `${sweepResult.expired} expired out of ${sweepResult.total_scanned} scanned ` +
        `(${sweepResult.sweep_duration_ms}ms).`
      );
      return sweepResult;
    }

        case 'custom': {
      const handler = config.handler as string | undefined;

      if (handler === 'free_model_daily_assignment') {
        const { runDailyAssignment } = await import('./freeModelDailyAssignment');
        return await runDailyAssignment();
      }

      if (handler === 'pool_health') {
        // Morning LLM free-account entitlement check: probes every pooled
        // credential, regenerates litellm.yaml to match, restarts the gateway
        // when routing changed. Writes .draymond/pool-health.json.
        const { runPoolHealth } = await import('./pool-health');
        const state = await runPoolHealth();
        return {
          handler,
          checked_at: state.checkedAt,
          muse_free_active: state.museFreeActiveKeys.length,
          free_active: state.freeActiveKeys.length,
          openrouter: state.openrouter?.status ?? 'absent',
          deepseek: state.deepseek?.status ?? 'absent',
          ollama_alive: `${state.ollamaCloud.filter((o) => o.ok).length}/${state.ollamaCloud.length}`,
        };
      }

      if (handler === 'benchmark_roster') {
        // Deep-score every pictured roster agent's repo (RepoRank/Grader/
        // Vibe-Reality) and queue the weakest for the self-learning loop.
        const { benchmarkRoster } = await import('./roster-benchmark');
        const r = await benchmarkRoster({ queueLimit: 10 });
        return { handler, ...r };
      }

      if (handler === 'check_all_sites') {
        const { checkAllSites } = await import('./monitors');
        const result = await checkAllSites();
        return {
          handler,
          checked_at: result.checked_at,
          total: result.total,
          up: result.up,
          down: result.down,
          errors: result.errors,
        };
      }

      if (handler === 'scan_book_library') {
        // Trigger a BookBridge library scan (auto-ingest new books).
        const { scanBookLibrary } = await import('../bookbridge');
        const result = await scanBookLibrary();
        return { handler, ...result };
      }

      if (handler === 'publish_social_queue') {
        // Drain the SMD publish queue → X/LinkedIn (deterministic publisher).
        const base = process.env.SOCIAL_MEDIA_URL?.replace(/\/+$/, '') ?? 'http://localhost:8030';
        const res = await fetch(`${base}/api/ai/publish/drain`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        if (!res.ok) throw new Error(`publish drain failed: HTTP ${res.status}`);
        const body = (await res.json()) as { checked?: number; processed?: number; persisted?: number; outcomes?: Array<{ status: string }> };
        return {
          handler,
          checked: body.checked ?? 0,
          processed: body.processed ?? 0,
          persisted: body.persisted ?? 0,
          statuses: (body.outcomes ?? []).reduce<Record<string, number>>((acc, o) => {
            acc[o.status] = (acc[o.status] ?? 0) + 1;
            return acc;
          }, {}),
        };
      }

      if (handler === 'wiki_sync') {
        // Sync the deterministic-brain wiki (markdown) into Supabase cache.
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const run = promisify(execFile);
        const out = await run('node', ['scripts/sync-wiki-to-sqlite.mjs'], { timeout: 120_000 });
        return { handler, output: (out.stdout || '').trim().slice(0, 1500) };
      }

      if (handler === 'benchmark_entities') {
        const { runBenchmarkCycle } = await import('./run-benchmark');
        const r = await runBenchmarkCycle('entity', { queueLimit: 5 });
        return { handler, ...r };
      }

      if (handler === 'benchmark_sites') {
        const { runBenchmarkCycle } = await import('./run-benchmark');
        const r = await runBenchmarkCycle('site', { queueLimit: 5 });
        return { handler, ...r };
      }

      if (handler === 'benchmark_crons') {
        const { runBenchmarkCycle } = await import('./run-benchmark');
        const r = await runBenchmarkCycle('cron', { queueLimit: 5 });
        return { handler, ...r };
      }

      if (handler === 'benchmark_chains') {
        const { runBenchmarkCycle } = await import('./run-benchmark');
        const r = await runBenchmarkCycle('chain', { queueLimit: 5 });
        return { handler, ...r };
      }

      if (handler === 'benchmark_deep_score') {
        // Thursday: deep-score the current weakest queued items.
        const { listUpgradeQueue } = await import('./upgrade-queue');
        const { runBenchmarkCycle } = await import('./run-benchmark');
        const queued = await listUpgradeQueue('queued');
        // Dedupe by class: running the full cycle once per class is enough to
        // deep-score that class's weakest component (repeated cycles on the
        // same class would re-collect/re-score identical data).
        const classes = [...new Set(queued.map((i) => i.component_class))].slice(0, 5);
        const results: Array<{ class: string; componentClass: import('./types').ComponentClass; measured: number; recorded: number; weakest: Array<{ slug: string; score: number }>; queued: number; deepScored: number }> = [];
        for (const cls of classes) {
          const r = await runBenchmarkCycle(cls, {
            queueLimit: 3,
            deepScoreLimit: 1,
          });
          results.push({ class: cls, ...r });
        }
        return { handler, deepScored: results.reduce((n, r) => n + r.deepScored, 0), results };
      }

      if (handler === 'benchmark_sync_roster') {
        // Sync RepoRank/Grader/Vibe-Reality benchmark scores onto the agent
        // roster stats and record % gains into the self-learning loop so the
        // system recognises the value of component improvements.
        const { syncRosterBenchmarks } = await import('./roster-stats');
        const { recordBenchmarkGains } = await import('./self-learning');
        const sync = await syncRosterBenchmarks();
        // Map gains per component to the roster agent slug that owns it.
        const { latestDeepScoredBenchmarks } = await import('./roster-stats');
        const { getAllAgents } = await import('@/lib/registry/agent-store');
        const [snapshots, agents] = await Promise.all([
          latestDeepScoredBenchmarks(),
          getAllAgents(),
        ]);
        const agentBySlug = new Map(agents.map((a) => [a.slug, a]));
        const { computeBenchmarkGains } = await import('./roster-stats');
        const gains: Array<{
          agentId: string;
          component: string;
          scorer: string;
          baseline: number | null;
          current: number | null;
          gainPct: number | null;
        }> = [];
        for (const s of snapshots) {
          // Agent slug matches entity slug for roster-owned components.
          const agent = agentBySlug.get(s.component_slug);
          const agentId = agent?.id ?? agent?.slug ?? s.component_slug;
          const perComponent = await computeBenchmarkGains(s.component_class, s.component_slug);
          for (const g of perComponent) {
            gains.push({
              agentId,
              component: g.component_slug,
              scorer: g.scorer,
              baseline: g.baseline,
              current: g.current,
              gainPct: g.gainPct,
            });
          }
        }
        const outcomes = await recordBenchmarkGains(gains);
        return {
          handler,
          rosterAgentsUpdated: sync.updated,
          statsBySlug: sync.statsBySlug,
          gainsRecorded: outcomes.length,
        };
      }

      if (handler === 'benchmark_upgrade_review') {
        const { listUpgradeQueue } = await import('./upgrade-queue');
        const fs = await import('node:fs');
        const path = await import('node:path');
        const queued = await listUpgradeQueue('queued');
        // The scheduler runs locally / on the orchestrator host where the nested
        // VibeServe repo is checked out, so anchoring to process.cwd() works as
        // long as the process is launched from the repo root (this file is bundled
        // into .next/server by Next.js, so a module-anchored path via
        // fileURLToPath(import.meta.url) would resolve to a build chunk, not the
        // source layout). On Vercel serverless the FS is read-only and the nested
        // repo is not deployed, so the write is a no-op that is caught and logged
        // to stdout only — acceptable for the current runtime; revisit if the cron
        // moves fully to the cloud.
        const pagePath = path.resolve(
          process.cwd(),
          'agents/VibeServe-main/ide/packages/deterministic-brain/wiki/business/system-health.md'
        );
        const cell = (s: string) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
        const rows = queued
          .slice(0, 10)
          .map((i) => `| ${cell(i.component_name)} | ${i.component_class} | ${i.weakness_score} | ${cell(i.proposed_action ?? '—')} |`)
          .join('\n');
        const body = [
          '---',
          'title: System Health',
          'tags: [health, benchmarks, weakness]',
          'namespace: business',
          'aliases: [system health, health report, weakest components]',
          'sources:',
          '  - code: src/lib/draymond/run-benchmark.ts',
          '---',
          '',
          '# System Health',
          '',
          `Updated: ${new Date().toISOString().slice(0, 10)}`,
          '',
          '## Current weakest components',
          '',
          '| Component | Class | Score | Action |',
          '|---|---|---|---|',
          rows || '| _none queued_ | — | — | — |',
          '',
        ].join('\n');
        try {
          fs.writeFileSync(pagePath, body, 'utf8');
        } catch (err) {
          console.error(`[benchmark_upgrade_review] failed to write wiki page: ${err}`);
        }
        return {
          handler,
          queued: queued.length,
          items: queued.slice(0, 10).map((i) => ({ slug: i.component_slug, score: i.weakness_score, action: i.proposed_action })),
        };
      }

      if (handler === 'run_overlay_qa') {
        // Run the Overlay365 Playwright QA suite via AgentBrowser.
        const { runSiteTests } = await import('../agentbrowser');
        const report = await runSiteTests('all');
        return {
          handler,
          overall: report.overall,
          summary: report.summary,
          sites: report.sites.map((s) => ({
            site: s.siteLabel,
            status: s.status,
            loadMs: s.loadMs,
            brokenLinks: s.brokenLinks?.length ?? 0,
            consoleErrors: s.consoleErrors?.length ?? 0,
          })),
        };
      }

      if (handler === 'fleet_duty_sync') {
        // Compute + log the on-duty roster (always-on / shift / on-call).
        const { computeFleetDuty } = await import('./fleet-duty');
        const roster: import('./fleet-duty').DutyStatus[] = computeFleetDuty();
        return {
          handler,
          checkedAt: new Date().toISOString(),
          onDuty: roster.filter((r) => r.active).map((r) => r.agentId),
          counts: {
            alwaysOn: roster.filter((r) => r.duty === 'always-on').length,
            shift: roster.filter((r) => r.duty === 'shift').length,
            onCall: roster.filter((r) => r.duty === 'on-call').length,
          },
        };
      }

      if (handler === 'github_awesome_scan') {
        // Weekly GitHub-Awesome tool-intake scan: channel feed → transcript →
        // candidates → Dev-Brain /api/intake → .draymond/tool-intake.json +
        // kairos/hypotheses handoff. Deterministic, no LLM.
        const { runGithubAwesomeScan } = await import('./github-awesome-scan');
        const scan = await runGithubAwesomeScan({ quiet: true });
        return {
          handler,
          episode: scan.episode?.title ?? null,
          candidates: scan.candidates.length,
          pulled: scan.pulled,
          topPicks: scan.topPicks.slice(0, 5).map((t) => `${t.title}(${t.compositeTriageScore})`),
          pruned: scan.pruned.length,
          handoff: scan.handoff,
        };
      }

      if (handler === 'ingest_news') {
        const { ingestNews, renderNewsDigest } = await import('./news');
        const { items, errors } = await ingestNews();
        return {
          handler, fetched: items.length, errors,
          digest: renderNewsDigest(items.slice(0, 5)),
        };
      }

      if (handler === 'self_learning_loop') {
        const { distillLessons } = await import('./self-learning');
        const lessons = await distillLessons();
        const result: Record<string, unknown> = { handler, lessons: lessons.length, top: lessons.slice(0, 5).map((l) => l.lesson) };
        // Self-learning now also runs the synthesis phase so sector conclusions
        // feed the grader + corpus and compound development nightly.
        const { runSynthesis } = await import('./synthesis');
        const synth = await runSynthesis();
        result.synthesis = synth;
        return result;
      }

      if (handler === 'synthesis_midday') {
        // Midday synthesis pass — same engine, more frequent cadence so
        // breakthroughs schedule faster than once/day.
        const { runSynthesis } = await import('./synthesis');
        const synth = await runSynthesis();
        return { handler, ...synth };
      }

      if (handler === 'clinvar_surveillance') {
        // Real NCBI ClinVar variant surveillance via the BioComposable proxy;
        // reclassifications feed the self-learning loop as discoveries.
        const { runClinVarSurveillance } = await import('./clinvar-surveillance');
        const summary = await runClinVarSurveillance();
        return { handler, ...summary };
      }

      if (handler === 'self_repair_check') {
        const { checkAllSites } = await import('./monitors');
        const { attemptRepair } = await import('./self-repair');
        const result = await checkAllSites();
        const down = result.results.filter((s) => !s.is_up);
        const repairs = [];
        for (const site of down.slice(0, 3)) {
          repairs.push(await attemptRepair('monitor:down', `${site.monitor_name || site.url} is down`));
        }
        // Ecosystem services down (BookBridge, brain, hemp stack) are started
        // directly — the real fix, not a report.
        const servicesDown: string[] = [];
        const serviceSlugs = ['bookbridge', 'deterministic-brain', 'hemp-os', 'hempforge', 'sports-steve', 'uplift-agent'];
        for (const site of down.slice(0, 5)) {
          const name = String(site.monitor_name ?? '').toLowerCase().replace(/[\s-_]+/g, '');
          for (const slug of serviceSlugs) {
            if (name.includes(slug.replace(/[\s-_]+/g, ''))) {
              servicesDown.push(slug);
              break;
            }
          }
        }
        const startedServices: Array<{ slug: string; up: boolean; detail: string }> = [];
        if (servicesDown.length > 0) {
          const { startDownServices } = await import('./service-manager');
          const started = await startDownServices([...new Set(servicesDown)].slice(0, 3));
          startedServices.push(...started.map((s) => ({ slug: s.slug, up: s.up, detail: s.detail })));
        }
        // Learning→repair feedback: escalate any repair loops (blind repairs
        // that keep being re-applied) to on-call instead of hammering them.
        const { escalateRepairLoops } = await import('./learning-repair');
        const loops = await escalateRepairLoops();
        return {
          handler,
          down: down.length,
          repairs: repairs.map((r) => ({ signal: r.signal, status: r.status, detail: r.detail })),
          servicesStarted: startedServices,
          loops: loops.map((l) => ({ signal: l.signal, attempts: l.attempts })),
        };
      }

      if (handler === 'rd_night') {
        const { buildNightPlan } = await import('./rd-night');
        const { newsDigest } = await import('./news');
        const digest = await newsDigest();
        const { tasks, brief } = await buildNightPlan(digest.items.slice(0, 5).map((i) => i.title));
        return { handler, queued: tasks.filter((t) => t.status === 'queued').length, brief };
      }

      if (handler === 'generate_agent_avatars') {
        // Generate agent portrait photos via the image-generation skill.
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const run = promisify(execFile);
        const out = await run('node', ['scripts/generate-agent-avatars.mjs'], { timeout: 600_000 });
        return { handler, output: (out.stdout || '').trim().slice(0, 1500) };
      }

      if (handler === 'fetch_market_data') {
        // Daily snapshot of free market/research sources for the fleet.
        const { cryptoPrices, openAlexWorks } = await import('./data-apis');
        const crypto = await cryptoPrices();
        const papers = await openAlexWorks('artificial intelligence business', 3);
        return { handler, crypto, topPapers: papers.map((p) => p.title) };
      }

      if (handler === 'phase_recap') {
        // Build + save + send a workplace recap for a day phase (email + Open-Chat).
        const phase = (job.job_config as { phase?: string })?.phase ?? 'evening';
        const { buildRecap, saveRecap, sendRecap } = await import('./communicator');
        const recap = await buildRecap(phase as never);
        await saveRecap(recap);
        const sent = await sendRecap(recap);
        return { handler, phase, summary: recap.summary, sent };
      }

      if (handler === 'evening_call_recap') {
        // Prepare the evening recap for a voice call via Aetherdesk/Open-Chat.
        const { buildRecap, renderRecap } = await import('./communicator');
        const recap = await buildRecap('evening');
        const text = renderRecap(recap);
        const callUrl = process.env.AETHERDESK_BASE_URL;
        let call = 'not-wired';
        if (callUrl) {
          try {
            const res = await fetch(`${callUrl.replace(/\/+$/, '')}/api/call`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ text, priority: 'recap' }),
              signal: AbortSignal.timeout(15_000),
            });
            call = `HTTP ${res.status}`;
          } catch { call = 'aetherdesk unreachable'; }
        }

        // Also publish the recap to ntfy tagged "call" so Open-Chat auto-speaks
        // it on the phone (Draymond calls through the Open-Chat tunnel). This is
        // the tunnel path — no Aetherdesk required.
        let ntfyCall = 'not-published';
        try {
          const ntfyBase = process.env.NTFY_URL;
          const ntfyTopic = process.env.NTFY_TOPIC_RESULTS;
          if (ntfyBase && ntfyTopic) {
            const res = await fetch(ntfyBase.replace(/\/+$/, ''), {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                topic: ntfyTopic,
                title: '📞 Call from Draymond',
                message: recap.summary,
                tags: ['call', 'recap'],
                priority: 5,
                click: process.env.DRAYMOND_PUBLIC_URL || '',
              }),
              signal: AbortSignal.timeout(10_000),
            });
            ntfyCall = `HTTP ${res.status}`;
          }
        } catch (err) {
          ntfyCall = `error: ${err instanceof Error ? err.message : String(err)}`;
        }

        return { handler, summary: recap.summary, call, ntfyCall, callTextLength: text.length };
      }

      if (handler === 'rotate_tokens') {
        // Report provider budget/rate health so keys can be rotated/refreshed
        // before they get exhausted or rate-limited.
        const { canCallProvider, laneSnapshot } = await import('./workflow-budget');
        const providers = ['opencode-free', 'opencode', 'deepseek', 'gemini', 'openai', 'anthropic', 'qwen', 'litellm'];
        return {
          handler,
          providerStatus: providers.map((p) => ({ provider: p, ok: canCallProvider(p).ok, reason: canCallProvider(p).reason ?? 'ok' })),
          lanes: laneSnapshot(),
        };
      }

      if (handler === 'repair_failed_jobs') {
        // Deploy the repair team on failed jobs (config fixes, crew assignment).
        // The crew consults distilled lessons for each job (learning → repair).
        const { listJobs, updateJob } = await import('./scheduler');
        const { repairFailedJob } = await import('./repair-team');
        const { repairHintsFor } = await import('./learning-repair');
        const failed = (await listJobs()).filter((j) => j.last_run_status === 'failed');
        const reports = [];
        const hintsByJob: Array<{ job: string; hints: number }> = [];
        for (const j of failed.slice(0, 10)) {
          const hints = await repairHintsFor(`scheduler:${j.name}`);
          hintsByJob.push({ job: j.name, hints: hints.length });
          reports.push(
            await repairFailedJob(
              { id: j.id, name: j.name, job_type: j.job_type, job_config: j.job_config ?? {} },
              j.last_error ?? 'unknown error',
              { updateJobConfig: (id, config) => updateJob(id, { job_config: config }) },
              hints.map((h) => h.lesson),
            ),
          );
        }
        return { handler, failed: failed.length, hintsByJob, reports };
      }

      if (handler === 'brain_decision_cycle') {
        // Draymond consults the deterministic brain's reasoning engine, aligned
        // to the operating agenda, and routes hiccups to the repair/coding
        // teams while feeding self-learning. See brain-decision.ts.
        const { runBrainDecision } = await import('./brain-decision');
        const decision = await runBrainDecision();
        return { handler, ...decision };
      }

      if (handler === 'agent_heartbeat_sweep') {
        // Ping every roster service health endpoint and record real liveness
        // so agents never sit at "unknown" forever. Down services are flagged.
        const { runHeartbeatSweep, getHeartbeats } = await import('./heartbeat');
        const sweep = await runHeartbeatSweep();
        const beats = await getHeartbeats();
        return { handler, ...sweep, heartbeats: beats };
      }

      if (handler === 'service_health_repair') {
        // Probe the ecosystem services; auto-start the ones that are down
        // (BookBridge, brain, hemp stack, ...). The repair team's job handler.
        const { probeAllServices, startDownServices, startableDownServices } = await import('./service-manager');
        const all = await probeAllServices();
        const down = all.filter((s) => !s.up).map((s) => s.slug);
        const startable = startableDownServices(down);
        const started = await startDownServices(startable.slice(0, 5));
        return {
          handler,
          checked: all.length,
          up: all.filter((s) => s.up).length,
          down,
          startable,
          started: started.map((s) => ({ slug: s.slug, up: s.up, detail: s.detail })),
        };
      }

      if (handler === 'api_key_audit') {
        // Audit which free-API keys are configured and feed the result to
        // self-learning so the fleet tracks the acquisition list. Never logs
        // key values — only configured? yes/no.
        const { auditApiKeys, missingCriticalKeys } = await import('./api-keys');
        const audit = auditApiKeys();
        try {
          const { recordOutcome } = await import('./self-learning');
          await recordOutcome({
            agentId: 'api-key-audit',
            kind: 'incident',
            summary: `api key audit: ${audit.configured} configured, ${audit.missing} missing, ${audit.noKey} keyless`,
            success: audit.missing === 0,
            detail: `missing: ${audit.missingNames.join(', ') || 'none'}`,
          });
        } catch { /* learning store best-effort */ }
        return { handler, ...audit, criticalMissing: missingCriticalKeys() };
      }

      if (handler === 'dispatch_worker_tasks') {
        // Dispatch marketing/social/email tasks to remote workers (Open Chat).
        const { dispatchWorkerTasks } = await import('./worker-tasks');
        const r = await dispatchWorkerTasks(config as import('./worker-tasks').DispatchWorkerTasksConfig);
        return { handler, ...r };
      }

      if (handler === 'file_share_check') {
        // Exercise the file-sharing / browser-fetch surface (AgentBrowser).
        // Fetches a target URL via the browser pipeline and reports content.
        const { browserFetch, isAgentBrowserConfigured } = await import('../agentbrowser');
        const target =
          (config as { url?: string }).url ?? process.env.OVERLAY_HEALTH_URL ?? 'https://uplift-health.vercel.app/';
        if (!isAgentBrowserConfigured()) {
          return { handler, status: 'skipped', reason: 'AgentBrowser not configured (AGENTBROWSER_URL + AGENTBROWSER_API_KEY)' };
        }
        const result = await browserFetch(target, 'get-content');
        return {
          handler,
          url: target,
          ok: result.success === true,
          error: result.error ?? null,
          contentBytes: (result.content ?? result.text ?? '').length,
        };
      }

      if (handler === 'code_review_check') {
        // Exercise the local deep-analysis / code-review scorer (Codegang).
        const { codegangAnalyzeFile, codegangIsUp } = await import('../ide/codegang-client');
        if (!(await codegangIsUp())) {
          return { handler, status: 'skipped', reason: 'Codegang offline (CODEGANG_URL)' };
        }
        const sample =
          (config as { content?: string }).content ??
          'export function add(a: number, b: number): number { return a + b; }\n\nfunction unusedHelper(n: number): number { return n * 2; }';
        const res = await codegangAnalyzeFile({ filePath: 'overlay/sample.ts', content: sample, language: 'typescript' });
        return {
          handler,
          ok: res.success === true,
          error: res.error ?? null,
          qualityScore: res.metrics?.qualityScore ?? null,
          totalIssues: res.metrics?.totalIssues ?? null,
          criticalCount: res.metrics?.criticalCount ?? null,
          highCount: res.metrics?.highCount ?? null,
        };
      }

      if (handler === 'systemic_consolidate') {
        // Run the systemic interconnection consolidation: distill lessons,
        // persist them as memory, and align agenda goals.
        const { consolidateSystem } = await import('./systemic');
        const result = await consolidateSystem();
        return { handler, ...result };
      }

      if (handler === 'systemic_interconnect') {
        // Full one-shot: seed agenda + knowledge graph + consolidate.
        const { interconnectSystem } = await import('./systemic');
        const result = await interconnectSystem();
        return { handler, ...result };
      }

      if (handler === 'editorial_push') {
        // Build + push the morning editorial articles to Sports Steve.
        const { buildEditorialArticles, pushEditorialToSteve } = await import('../sports-steve-editorial');
        const articles = await buildEditorialArticles();
        const pushed = await pushEditorialToSteve(articles);
        return { handler, built: articles.length, pushed: pushed.imported };
      }

      if (handler === 'treasury_pulse') {
        // Treasurer cash pulse — settled Stripe revenue only. Feeds the
        // business pipeline + recaps. Wired to the day-orchestrator's 08:00
        // treasury step (the old `overlay-treasurer` job had no handler).
        const { runTreasuryPulse } = await import('./treasury');
        const lookbackDays = Number(process.env.TREASURY_LOOKBACK_DAYS ?? 30);
        const r = await runTreasuryPulse(Number.isFinite(lookbackDays) ? lookbackDays : 30);
        // Catch-up sale alerts: anything the webhook missed while Draymond was
        // offline fires now. Best-effort.
        let saleAlerts = 0;
        try {
          const { sendSaleAlerts } = await import('./sale-alerts');
          saleAlerts = (await sendSaleAlerts()).length;
        } catch {
          /* sale alerts best-effort */
        }
        return {
          handler,
          status: r.status,
          revenueUsd: r.revenueUsd,
          newSettled: r.newSettled,
          error: r.error ?? null,
          saleAlerts,
          report: r.markdown.slice(0, 1500),
        };
      }

      if (handler === 'mission_strategy_review') {
        const { missionDashboard } = await import('./mission-pipeline');
        const { readStrategy, totalMonthlyTarget } = await import('./mission-strategy');
        const { settledRevenueUsd } = await import('./treasury-state');
        const [dash, strategy, revenue] = await Promise.all([missionDashboard(), readStrategy(), settledRevenueUsd()]);
        const target = totalMonthlyTarget(strategy);
        const memo = [
          '# Mission Strategy Review',
          '',
          `**Settled revenue to date: $${revenue}** (target: $${target}/mo by day ${strategy.runwayDays})`,
          `**Pipeline:** ${dash.opportunities.total} opps · ${dash.velocity.leads} leads · ${dash.velocity.won} won · ${dash.velocity.invoiced} invoiced · ${dash.velocity.paid} paid`,
          '',
          '| Service | Target | Won (USD) | Paid (USD) |',
          '|---|---|---|---|',
          ...strategy.services.map((s) => `| ${s.name} | $${s.targetMonthly} | $${dash.byService[s.id].won} | $${dash.byService[s.id].paid} |`),
          '',
          `Revenue vs target: ${revenue >= target ? 'ON TARGET' : `$${Math.max(0, target - revenue)} short`}`,
        ].join('\n');
        try {
          const { sendNotification } = await import('./notifications');
          await sendNotification({
            channel: 'email',
            recipient: process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER ?? 'admin@localhost',
            subject: 'Mission Strategy Review',
            body: memo,
            type: 'custom',
            priority: 'normal',
          });
        } catch (e) { console.error('[scheduler] mission strategy review notify failed:', e); }
        return { handler, revenue, target, memo: memo.slice(0, 1500) };
      }

      if (handler === 'mission_pipeline_sync') {
        const { missionDashboard } = await import('./mission-pipeline');
        const { listOpportunities } = await import('./business-pipeline');
        const dash = await missionDashboard();
        const ops = await listOpportunities();
        // Flag leads older than 14 days as stale (diagnostic only — no mutation).
        const stale = ops.filter((o) => o.stage === 'lead' && Date.now() - new Date(o.updatedAt).getTime() > 14 * 86400_000);
        return { handler, total: dash.opportunities.total, byStage: dash.opportunities.byStage, staleLeads: stale.map((o) => o.id) };
      }

      if (handler === 'mission_run_maas_cycle') {
        const { listOpportunities } = await import('./business-pipeline');
        const { dispatchDelivery } = await import('./mission-delivery');
        const clients = (await listOpportunities()).filter((o) => o.serviceId === 'maas' && (o.stage === 'won' || o.stage === 'delivering'));
        const results = [];
        for (const c of clients.slice(0, 10)) results.push(await dispatchDelivery(c.id));
        return { handler, clients: clients.length, results };
      }

      if (handler === 'kairos_scan') {
        // Proactive fleet scan — surface kairos moments (down monitors, failed
        // jobs, stale leads, revenue shortfall, budget pressure, weak agents,
        // repair loops, stale heartbeats).
        const { kairosScan } = await import('./kairos');
        const r = await kairosScan();
        return { handler, ...r };
      }

      if (handler === 'dream_cycle') {
        // AutoDream — gated 4-phase memory consolidation (self-gates, never throws).
        const { runDreamCycle } = await import('./dream-cycle');
        const r = await runDreamCycle();
        return { handler, gatedBy: r.gatedBy ?? null, sessionsCounted: r.sessionsCounted, entries: r.entries };
      }

      if (handler === 'ultraplan_process') {
        // Drain the oldest queued ultraplan through the deep-planning lane.
        const { processNextUltraplan } = await import('./ultraplan');
        const r = await processNextUltraplan();
        return { handler, ...r };
      }

      if (handler === 'research_rotation') {
        // Research rotation: drain the highest-priority ready science experiment.
        const { researchRotation } = await import('@/lib/science/experiments');
        const r = await researchRotation();
        return { handler, ...r };
      }

      if (handler === 'science_campaign_seed') {
        // Campaign seeding: top up the science/sports experiment backlog from
        // real datasets + papers so rotation always has work.
        const { ensureResearchBacklog } = await import('@/lib/science/campaigns');
        const r = await ensureResearchBacklog();
        return { handler, ...r };
      }

      if (handler === 'benchmark_discovery_loop') {
        // Autonomous research: run the Benchmark Olympics discovery loop against
        // the real fleet registry, mature hypotheses, push quick-upgrade
        // insights to /api/v1/benchmarks, and dispatch the weakest components
        // to the repair team for auto-fixing.
        const { runDiscoveryLoopScript } = await import('./discovery-loop-runner');
        const iterations = Math.max(1, Math.min(4, Number((config as { iterations?: unknown }).iterations) || 1));
        const res = await runDiscoveryLoopScript({ iterations, repair: process.env.DRAYMOND_REPAIR_BENCHMARK_ENABLED !== '0' });
        return { handler, iterations, ok: res.ok, duration_ms: res.durationMs, output: (res.stdout || '').trim().slice(-1500), error: res.error };
      }

      if (handler === 'repair_shift') {
        // Daily fleet repair shift: code-review audit -> repair/upgrade ->
        // benchmark improvements -> self-learning. The repair team is on shift
        // every day; the code review team audits; improvements are benchmarked.
        // Options flow from the job config so operators can tune cost (deep
        // scoring hits RepoRank/Grader over HTTP).
        const { runRepairShift } = await import('./repair-shift');
        const cfg = (config ?? {}) as { skipDeepScore?: unknown; deepScoreLimit?: unknown; maxComponents?: unknown; maxJobs?: unknown };
        const r = await runRepairShift({
          skipDeepScore: cfg.skipDeepScore === true || cfg.skipDeepScore === 'true',
          deepScoreLimit: cfg.deepScoreLimit != null ? Number(cfg.deepScoreLimit) : undefined,
          maxComponents: cfg.maxComponents != null ? Number(cfg.maxComponents) : undefined,
          maxJobs: cfg.maxJobs != null ? Number(cfg.maxJobs) : undefined,
        });
        return {
          handler,
          shiftId: r.shiftId,
          measured: r.audit.measured,
          deepScored: r.audit.deepScored,
          weakest: r.audit.weakest.slice(0, 5),
          jobsRepaired: r.repair.jobsRepaired,
          componentsRepaired: r.repair.componentsRepaired,
          servicesStarted: r.repair.servicesStarted,
          failures: r.repair.failures.slice(0, 5),
          improvements: r.improvements.slice(0, 5),
          lessons: r.lessons,
          duration_ms: r.durationMs,
        };
      }

      if (handler === 'research_grade_loop') {
        // Breakthrough-potential grading of CureMind/BB-Tech research output.
        // Feeds the self-learning system + trends/insights/discoveries so the
        // scientific research system consistently gets smarter.
        const { gradeResearch } = await import('@/lib/science/research-grade');
        const r = await gradeResearch();
        // BBTech science step (keyed like a chain step's output_key, cf.
        // business-chains 'trends'): synthesize cross-domain InsightReports
        // over the real NBA dataset profiles and persist them into the
        // science_insights trends store. Fail-soft — an unavailable python
        // runtime or dataset dir is recorded, never thrown.
        let bbtechScience: BbtechInsightSyncResult;
        try {
          const { syncBbtechInsights } = await import('@/lib/science/trendsFeed');
          bbtechScience = await syncBbtechInsights();
        } catch (err) {
          bbtechScience = {
            ok: false,
            profilesFound: 0,
            synthesized: 0,
            persisted: 0,
            duplicates: 0,
            errors: [err instanceof Error ? err.message : String(err)],
            reason: 'bbtech insight sync failed',
          };
        }
        // Research-gap drain step (fail-soft like bbtech_science): push open
        // science_gaps to OmniResearch so deep-research work never stalls.
        // Offline OmniResearch degrades honestly — gaps stay open (queued).
        let gapDrain: GapDrainResult;
        try {
          const { drainOpenGaps } = await import('@/lib/science/researchEscalation');
          gapDrain = await drainOpenGaps();
        } catch (err) {
          gapDrain = {
            ok: false,
            dispatched: 0,
            queued: 0,
            errors: [err instanceof Error ? err.message : String(err)],
            reason: 'gap drain failed',
          };
        }
        return {
          handler,
          graded: r.grades.length,
          frontier: r.grades.filter((g) => g.breakthroughClass === 'frontier').length,
          promising: r.grades.filter((g) => g.breakthroughClass === 'promising').length,
          top: r.grades.slice(0, 5).map((g) => ({ goalId: g.goalId, score: g.score, evidence: g.evidenceTier, class: g.breakthroughClass })),
          discoveries: r.discoveries.map((g) => ({ goalId: g.goalId, score: g.score })),
          insights: r.insights.slice(0, 5).map((i) => ({ type: i.type, detail: i.detail })),
          bbtech_science: {
            ok: bbtechScience.ok,
            profiles_found: bbtechScience.profilesFound,
            synthesized: bbtechScience.synthesized,
            persisted: bbtechScience.persisted,
            duplicates: bbtechScience.duplicates,
            errors: bbtechScience.errors.slice(0, 5),
            ...(bbtechScience.reason ? { reason: bbtechScience.reason } : {}),
          },
          gap_escalation: {
            ok: gapDrain.ok,
            dispatched: gapDrain.dispatched,
            queued: gapDrain.queued,
            errors: gapDrain.errors.slice(0, 5),
            ...(gapDrain.reason ? { reason: gapDrain.reason } : {}),
          },
        };
      }

      if (handler === 'science_paper_refresh') {
        // Refresh the literature cache for every active science goal so
        // research-papers.json never goes stale. Forced (ignores the 24h cache)
        // so the weekly refresh actually pulls fresh papers.
        const { refreshSciencePapers } = await import('@/lib/science/publish');
        const r = await refreshSciencePapers(true);
        return { handler, ...r };
      }

      if (handler === 'science_publication_loop') {
        // Publish frontier/promising discoveries to Overlay Global Lens and
        // drain the publication→self-learning feed. Fail-soft: an unreachable
        // Global Lens or a bad item never throws the cron.
        const { publishFrontierDiscoveries } = await import('@/lib/science/publish');
        const r = await publishFrontierDiscoveries();
        return { handler, ...r };
      }

      if (handler === 'nba_stats_ingest') {
        // Run the sports_science metrics pipeline over NBA dataset profiles and
        // optionally pull live game logs. Fail-soft when the python runtime or
        // dataset is unavailable.
        const { ingestNbaStats } = await import('./sports-pipeline');
        const r = await ingestNbaStats();
        return { handler, ...r };
      }

      if (handler === 'bankroll_pulse') {
        // Surface Sports Steve bankroll/P&L/bets into Draymond state. Fail-soft
        // when Sports Steve is unreachable.
        const { bankrollPulse } = await import('./sports-pipeline');
        const r = await bankrollPulse();
        return { handler, ...r };
      }

      if (handler === 'finance_strategy_brief') {
        // Pull the finance-connect daily strategy brief (book-grounded). The
        // day-orchestrator's 08:15 step; finance-connect may be unconfigured →
        // returns ok:false, never throws.
        const { fetchFinanceBrief } = await import('./finance-sync');
        const r = await fetchFinanceBrief();
        return { handler, ...r };
      }

      if (handler === 'finance_goals_sync') {
        // Sync capability-grounded finance goals into draymond_goals (08:45).
        const { syncFinanceGoals } = await import('./finance-sync');
        const { createGoal, updateGoalProgress } = await import('./index');
        const r = await syncFinanceGoals({ createGoal, updateGoalProgress });
        return { handler, synced: r.filter((x) => x.ok).length, total: r.length };
      }

      if (handler === 'wf_mission_sync') {
        // Daily mission pipeline + revenue-vs-target sync (the 09:30 agenda
        // step). Mirrors mission_pipeline_sync but runs at the morning slot the
        // day-orchestrator plans for the mission workflow.
        const { missionDashboard } = await import('./mission-pipeline');
        const { listOpportunities } = await import('./business-pipeline');
        const dash = await missionDashboard();
        const ops = await listOpportunities();
        const stale = ops.filter(
          (o) => o.stage === 'lead' && Date.now() - new Date(o.updatedAt).getTime() > 14 * 86400_000
        );
        return {
          handler,
          total: dash.opportunities.total,
          byStage: dash.opportunities.byStage,
          staleLeads: stale.map((o) => o.id),
        };
      }

      if (handler === 'commission_payout') {
        // Weekly staffing commission payout (every Friday). The commission
        // engine owns the payout logic (eligibility, Stripe Connect transfers,
        // commission status updates); we just trigger it via HTTP. Reads the
        // engine URL + API key from env. Fails loudly so a misconfigured key
        // is obvious — silent skip would let payouts stack up unnoticed.
        const base = (process.env.COMMISSION_ENGINE_URL ?? 'http://127.0.0.1:8003').replace(/\/+$/, '');
        const apiKey = process.env.COMMISSION_ENGINE_API_KEY ?? '';
        if (!apiKey) {
          throw new Error(
            'commission_payout: COMMISSION_ENGINE_API_KEY is not set; refusing to run silently.'
          );
        }
        const res = await fetch(`${base}/api/v1/payouts/run`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: '{}',
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`commission_engine HTTP ${res.status}: ${body.slice(0, 500)}`);
        }
        const result = (await res.json()) as {
          payouts?: Array<{
            id: string;
            agent_id: string;
            amount: string;
            status: string;
            stripe_transfer_id: string | null;
          }>;
          errors?: string[];
        };
        return {
          handler,
          triggered_at: new Date().toISOString(),
          payouts_total: result.payouts?.length ?? 0,
          payouts_completed: (result.payouts ?? []).filter((p) => p.status === 'completed').length,
          payouts_failed: (result.payouts ?? []).filter((p) => p.status === 'failed').length,
          total_amount: (result.payouts ?? [])
            .filter((p) => p.status === 'completed')
            .reduce((sum, p) => sum + Number(p.amount), 0),
          errors: result.errors ?? [],
        };
      }

      console.log(
        `[Draymond Scheduler] Custom job "${job.name}" triggered (handler: ${handler ?? 'none'}). ` +
        `No built-in handler registered — skipping execution.`
      );
      return { handler, status: 'logged', message: 'Custom handler not yet implemented' };
    }

    default:
      throw new Error(`Unknown job_type: ${job.job_type}`);
  }
}

export interface RunDueJobsOptions {
  /**
   * When set, jobs overdue by more than the 15-min grace are still RUN (not
   * skipped) as long as they are not overdue by more than `catchupMs`. Used by
   * the boot catch-up pass so missed work executes when Draymond starts, while
   * an ordinary tick keeps the strict "never run late" behaviour.
   */
  catchupMs?: number;
}

/**
 * Find all enabled jobs whose `next_run_at <= now()`, claim them atomically,
 * execute them, and update their run metadata.
 *
 * Uses an atomic claim pattern: each job is claimed with an UPDATE that sets
 * `last_run_status = 'running'` only if it is NOT already running. This
 * prevents duplicate execution from concurrent cron invocations.
 *
 * Returns an array of results for each job attempted.
 */
export async function runDueJobs(now = new Date(), opts?: RunDueJobsOptions): Promise<JobRunResult[]> {
  const supabase = createDraymondAdminClient();
  const results: JobRunResult[] = [];
  const recipient = getNotificationRecipient();

  // ── 0. Recover stale 'running' locks ───────────────────────────────────
  // If the process crashed while a job was mid-flight, its row stays
  // `last_run_status = 'running'` forever and the atomic claim below (which
  // filters `.neq('running')`) would permanently skip it. A run is dead when
  // its lease expired (process died) — marked `recovered`, NOT `failed`, so a
  // crash doesn't manufacture a failure storm; the job self-heals on its next
  // slot. Legacy rows without a lease fall back to the old 45-min threshold.
  const staleRunningMs = Number(process.env.DRAYMOND_STALE_RUNNING_MS ?? 45 * 60 * 1000);
  const staleNowMs = now.getTime();
  try {
    const { data: staleRunning, error: staleErr } = await supabase
      .from('draymond_scheduled_jobs')
      .select('id, name, lease_expires_at, last_run_at')
      .eq('last_run_status', 'running');
    if (staleErr) {
      console.error('[Draymond Scheduler] stale-running scan failed:', staleErr.message);
    } else if (staleRunning && staleRunning.length > 0) {
      const staleIds: string[] = [];
      for (const s of staleRunning) {
        if (!isStaleLease(s.lease_expires_at, s.last_run_at, staleNowMs, staleRunningMs)) continue;
        staleIds.push(s.id);
        await supabase
          .from('draymond_scheduled_jobs')
          .update({
            last_run_status: 'recovered',
            lease_expires_at: null,
            last_error: 'Recovered stale running lock (previous process crashed mid-run)',
          })
          .eq('id', s.id);
      }
      if (staleIds.length > 0) {
        console.log(`[Draymond Scheduler] recovered ${staleIds.length} stale running lock(s): ${staleRunning.filter((s: { id: string; name?: unknown }) => staleIds.includes(s.id)).map((s: { name?: unknown }) => String(s.name ?? '')).join(', ')}`);
      }
    }
  } catch (err) {
    console.error('[Draymond Scheduler] stale-running recovery failed:', err instanceof Error ? err.message : err);
  }

  // ── 0b. Recover stale 'running' CHAINS ───────────────────────────────────
  // Chain instances that crashed mid-run stay `status = 'running'` forever and
  // block re-execution of that instance (and clutter the chain history with
  // phantom in-flight rows). A chain is dead when its lease expired (process
  // died); legacy rows fall back to the updated_at threshold. Marked `failed`
  // so operators can see and resume them.
  try {
    const { data: staleChains, error: chainErr } = await supabase
      .from('draymond_chains')
      .select('id, slug, lease_expires_at, updated_at')
      .eq('status', 'running');
    if (chainErr) {
      console.error('[Draymond Scheduler] stale-chain scan failed:', chainErr.message);
    } else if (staleChains && staleChains.length > 0) {
      const staleChainIds: string[] = [];
      for (const c of staleChains) {
        if (!isStaleLease(c.lease_expires_at, c.updated_at, staleNowMs, staleRunningMs)) continue;
        staleChainIds.push(c.id);
        await supabase
          .from('draymond_chains')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            lease_expires_at: null,
            error_message: 'Recovered stale running chain (previous process crashed mid-run)',
          })
          .eq('id', c.id);
      }
      if (staleChainIds.length > 0) {
        console.log(`[Draymond Scheduler] recovered ${staleChainIds.length} stale running chain(s): ${staleChains.filter((c: { id: string; slug?: unknown }) => staleChainIds.includes(c.id)).map((c: { slug?: unknown }) => String(c.slug ?? '')).join(', ')}`);
      }
    }
  } catch (err) {
    console.error('[Draymond Scheduler] stale-chain recovery failed:', err instanceof Error ? err.message : err);
  }

  // 1. Fetch candidate due jobs
  const { data: dueJobs, error: fetchError } = await supabase
    .from('draymond_scheduled_jobs')
    .select('*')
    .eq('is_enabled', true)
    .neq('last_run_status', 'running')
    .lte('next_run_at', now.toISOString())
    .order('next_run_at', { ascending: true });

  if (fetchError) {
    throw new Error(`Failed to fetch due jobs: ${fetchError.message}`);
  }

  if (!dueJobs || dueJobs.length === 0) {
    return results;
  }

  // 2. Partition into "run now" vs "too late — skip + reschedule".
  // A job whose next_run_at is far in the past (machine off overnight, external
  // cron only fired at 6am, etc.) should NOT fire late: that's the "night recap
  // at 6am" bug. It gets skipped (no execution, no email spam) and rescheduled
  // to its next real slot. Freshly-due jobs (within CATCH_UP_GRACE_MS) run.
  //
  // During a boot catch-up (`catchupMs` set) the horizon widens so jobs missed
  // while the server was off are EXECUTED instead of skipped — the work happens
  // when Draymond starts, bounded so ancient slots are not replayed.
  const nowMs = now.getTime();
  const runnable: ScheduledJob[] = [];
  const stale: ScheduledJob[] = [];
  const deferred: ScheduledJob[] = [];
  for (const raw of dueJobs) {
    const job = raw as ScheduledJob;
    const dueMs = job.next_run_at ? new Date(job.next_run_at).getTime() : nowMs;
    const overdueMs = Number.isFinite(dueMs) ? nowMs - dueMs : 0;
    if (isOutsideDelegationWindow(job, now)) {
      // The handler's delegation window is closed right now — defer instead of
      // burning tokens on work scheduled for another time of day.
      deferred.push(job);
    } else if (Number.isFinite(dueMs) && overdueMs > CATCH_UP_GRACE_MS) {
      // Overdue beyond the strict grace. In catch-up mode, still run if within
      // the horizon; otherwise treat as stale.
      if (opts?.catchupMs && overdueMs <= opts.catchupMs) {
        runnable.push(job);
      } else {
        stale.push(job);
      }
    } else {
      runnable.push(job);
    }
  }

  // Defer jobs whose delegation window is closed. Same treatment as stale:
  // skip execution, advance next_run_at, no notifications or token spend.
  for (const job of deferred) {
    try {
      const nextRunAt = getNextRunTime(job.cron_expression, now).toISOString();
      await supabase
        .from('draymond_scheduled_jobs')
        .update({
          last_run_at: now.toISOString(),
          last_run_status: 'skipped',
          last_error: `Delegation window closed (${delegationWindowLabel(job)}) — deferred to next scheduled slot`,
          next_run_at: nextRunAt,
        })
        .eq('id', job.id);
      results.push({
        job_id: job.id,
        job_name: job.name,
        job_type: job.job_type,
        status: 'skipped',
        duration_ms: 0,
        error: `Delegation window closed (${delegationWindowLabel(job)}) — deferred`,
      });
    } catch (err) {
      console.error(`[Draymond Scheduler] Failed to defer job "${job.name}":`, err);
    }
  }

  // Reschedule stale jobs WITHOUT executing them. No notifications, no
  // learning outcomes, no token burn — just advance next_run_at.
  for (const job of stale) {
    try {
      const nextRunAt = getNextRunTime(job.cron_expression, now).toISOString();
      await supabase
        .from('draymond_scheduled_jobs')
        .update({
          last_run_at: now.toISOString(),
          last_run_status: 'skipped',
          last_error: `Missed window (overdue by ${Math.round((nowMs - new Date(job.next_run_at!).getTime()) / 60000)}min) — skipped and rescheduled to avoid late/duplicate execution`,
          next_run_at: nextRunAt,
        })
        .eq('id', job.id);
      results.push({
        job_id: job.id,
        job_name: job.name,
        job_type: job.job_type,
        status: 'skipped',
        duration_ms: 0,
        error: 'Missed window — rescheduled',
      });
    } catch (err) {
      console.error(`[Draymond Scheduler] Failed to reschedule stale job "${job.name}":`, err);
    }
  }

  if (runnable.length === 0) {
    return results;
  }

  // 3. Execute each runnable job with atomic claim
  for (const raw of runnable) {
    const job = raw as ScheduledJob;

    // Atomic claim: only mark as running if still not running.
    // If another worker already claimed this job, the update returns 0 rows.
    const { data: claimed, error: claimError } = await supabase
      .from('draymond_scheduled_jobs')
      .update({ last_run_status: 'running', lease_expires_at: leaseExpiryIso(now) })
      .eq('id', job.id)
      .neq('last_run_status', 'running')
      .select('id')
      .maybeSingle();

    if (claimError) {
      console.error(`[Draymond Scheduler] Failed to claim job "${job.name}":`, claimError.message);
      continue;
    }

    // If no row returned, another worker already claimed this job — skip
    if (!claimed) {
      results.push({
        job_id: job.id,
        job_name: job.name,
        job_type: job.job_type,
        status: 'skipped',
        duration_ms: 0,
        error: 'Already claimed by another worker',
      });
      continue;
    }

    const startTime = Date.now();
    const stopHeartbeat = startJobHeartbeat(job.id);
    emitJobStarted(job.id, job.name, job.job_type);

    // Execute with job-level retries (max_retries). The job was claimed above
    // so a single retry loop owns this slot; failed attempts back off before
    // the next try and only the FINAL failure is recorded/notified (no spam).
    // Only transient failures are retried — fatal ones break immediately.
    let lastError: unknown = null;
    let output: unknown = null;
    for (let attempt = 0; attempt <= job.max_retries; attempt++) {
      try {
        output = await executeJobByType(job);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempt >= job.max_retries || classifyRetryable(errMsg) !== 'retryable') {
          break;
        }
        console.log(
          `[Draymond Scheduler] job "${job.name}" attempt ${attempt + 1}/${job.max_retries + 1} failed, retrying in ${retryDelayMs(attempt)}ms: ${errMsg}`
        );
        await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
      }
    }

    if (!lastError) {
      const durationMs = Date.now() - startTime;
      stopHeartbeat();

      // Compute next run
      const nextRunAt = getNextRunTime(job.cron_expression, now).toISOString();

      // Update success state with atomic increment via raw SQL-safe pattern
      // Use Supabase's RPC-free approach: read current values then write.
      // The claim pattern above prevents concurrent writes to the same job.
      await supabase
        .from('draymond_scheduled_jobs')
        .update({
          last_run_at: now.toISOString(),
          last_run_status: 'success',
          last_run_duration_ms: durationMs,
          last_error: null,
          lease_expires_at: null,
          run_count: job.run_count + 1,
          next_run_at: nextRunAt,
        })
        .eq('id', job.id);

      emitJobCompleted(job.id, job.name, job.job_type, durationMs);

      results.push({
        job_id: job.id,
        job_name: job.name,
        job_type: job.job_type,
        status: 'success',
        duration_ms: durationMs,
        output,
      });

      // Optional success notification
      if (job.notify_on_success && recipient) {
        try {
          await sendAlertEmail(
            recipient,
            `Scheduled job "${job.name}" completed successfully`,
            `Job "${job.name}" (${job.job_type}) finished in ${durationMs}ms.\n\nRun count: ${job.run_count + 1}`,
            'custom',
            { priority: 'low', metadata: { job_id: job.id, duration_ms: durationMs } }
          );
        } catch (notifyErr) {
          console.error(`[Draymond Scheduler] Failed to send success notification for "${job.name}":`, notifyErr);
        }
      }
    } else {
      const durationMs = Date.now() - startTime;
      const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
      const retried = job.max_retries > 0 ? ` (after ${job.max_retries} retries)` : '';

      // Compute next run even on failure
      const nextRunAt = getNextRunTime(job.cron_expression, now).toISOString();

      // Update failure state
      stopHeartbeat();
      await supabase
        .from('draymond_scheduled_jobs')
        .update({
          last_run_at: now.toISOString(),
          last_run_status: 'failed',
          last_run_duration_ms: durationMs,
          last_error: errorMessage,
          lease_expires_at: null,
          run_count: job.run_count + 1,
          fail_count: job.fail_count + 1,
          next_run_at: nextRunAt,
        })
        .eq('id', job.id);

      emitJobFailed(job.id, job.name, job.job_type, errorMessage);

      // Feed the failure to the learning loop (distilled into lessons nightly)
      // and to Sentry for aggregation — both best-effort, never break the job.
      try {
        const { recordOutcome } = await import('./self-learning');
        await recordOutcome({
          agentId: `scheduler:${job.name}`,
          kind: 'job',
          summary: `scheduler job failed: ${job.name}`,
          success: false,
          detail: errorMessage.slice(0, 500),
        });
      } catch {
        /* learning store best-effort */
      }
      try {
        const { captureException } = await import('../sentry');
        await captureException(lastError instanceof Error ? lastError : new Error(errorMessage), {
          tags: { component: 'scheduler', job: job.name, job_type: job.job_type },
        });
      } catch {
        /* observability best-effort */
      }

      results.push({
        job_id: job.id,
        job_name: job.name,
        job_type: job.job_type,
        status: 'failed',
        duration_ms: durationMs,
        error: errorMessage,
      });

      // Failure notification
      if (job.notify_on_failure && recipient) {
        try {
          await sendAlertEmail(
            recipient,
            `Scheduled job "${job.name}" FAILED`,
            `Job "${job.name}" (${job.job_type}) failed after ${durationMs}ms${retried}.\n\nError: ${errorMessage}\n\nFail count: ${job.fail_count + 1} / Run count: ${job.run_count + 1}`,
            'agent_failure',
            { priority: 'high', metadata: { job_id: job.id, duration_ms: durationMs, error: errorMessage } }
          );
        } catch (notifyErr) {
          console.error(`[Draymond Scheduler] Failed to send failure notification for "${job.name}":`, notifyErr);
        }
      }

      // Real-time chat alert via the tunnel so the user can diagnose + repair
      // from Open-Chat without waiting for the batched email.
      if (job.notify_on_failure) {
        try {
          const { publishIssueNotification } = await import('./ntfy');
          await publishIssueNotification({
            title: `Draymond · ${job.name} FAILED`,
            message: `Job "${job.name}" (${job.job_type}) failed after ${durationMs}ms.\n\nError: ${errorMessage}\n\nFail count: ${job.fail_count + 1} / Run count: ${job.run_count + 1}`,
            priority: 5,
            tags: ['rotating_light', 'warning'],
            repair: {
              kind: 'job',
              signal: 'job:error',
              detail: errorMessage,
              job: { id: job.id, name: job.name, job_type: job.job_type, job_config: job.job_config ?? {} },
            },
          });
        } catch (notifyErr) {
          console.error(`[Draymond Scheduler] Failed to push failure chat alert for "${job.name}":`, notifyErr);
        }
      }

      // IMMEDIATE repair dispatch — don't wait for the hourly Repair Team job.
      // The repair/coding crew starts on the first failure now; the per-job
      // cooldown inside repairFailedJob stops repeated identical failures from
      // re-dispatching and burning tokens. Best-effort: it can never break the
      // scheduler tick. Disable with DRAYMOND_REPAIR_AT_FAILURE=0.
      if (process.env.DRAYMOND_REPAIR_AT_FAILURE !== '0') {
        try {
          const { updateJob } = await import('./scheduler');
          const { repairFailedJob } = await import('./repair-team');
          await repairFailedJob(
            { id: job.id, name: job.name, job_type: job.job_type, job_config: job.job_config ?? {} },
            errorMessage,
            { updateJobConfig: (id, config) => updateJob(id, { job_config: config }) },
            [],
            {
              // Respect DRAYMOND_REPAIR_IMMEDIATE so the legacy evidence gate
              // still applies when the operator opts out of first-failure
              // dispatch (DRAYMOND_REPAIR_AT_FAILURE=0 stops this entirely).
              immediate: process.env.DRAYMOND_REPAIR_IMMEDIATE !== '0',
              // The codegen repair runs a real LLM call (opencode Go tier via
              // LiteLLM). It can take 30–90s for a reasoning pass, so the
              // immediate window must clear it — 30s used to abort mid-repair
              // and hand everything to the (often dead) fallback engines.
              dispatchTimeoutMs: Number(process.env.DRAYMOND_REPAIR_AT_FAILURE_TIMEOUT_MS) || 120_000,
            },
          );
        } catch (repairErr) {
          console.error(`[Draymond Scheduler] Immediate repair dispatch failed for "${job.name}":`, repairErr);
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Seeded default jobs (basic tasks) — created on first run so the scheduler
// starts with useful automation even before the user adds any.
// ---------------------------------------------------------------------------

const BASIC_JOBS: ScheduledJobInsert[] = [
  {
    name: 'Fleet Health Check',
    description: 'Daily 8am health check across all registered agents and monitors.',
    cron_expression: '0 8 * * *',
    job_type: 'health_check',
    is_enabled: true,
  },
  {
    name: 'Market News Digest',
    description: 'Daily 7am market & news digest from research agents.',
    cron_expression: '0 7 * * *',
    job_type: 'notification',
    // Previously seeded with no job_config at all, so the notification
    // validator always rejected it. Give it a working payload (recipient
    // resolved from env so the job survives without hard-coded email config).
    job_config: {
      payload: {
        recipient: process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER ?? 'admin@localhost',
        subject: 'Daily Market & News Digest',
        body: 'Morning market and news digest is ready — see the Draymond dashboard / Open-Chat for the full briefing.',
        channel: 'email',
      },
    },
    is_enabled: true,
  },
  {
    name: 'Social Publish Drainer',
    description: 'Drain the SMD publish queue to X/LinkedIn every 30 minutes.',
    cron_expression: '*/30 * * * *',
    job_type: 'custom',
    job_config: { handler: 'publish_social_queue' },
    is_enabled: true,
  },
  {
    name: 'Weekly Operations Review',
    description: 'Weekly Monday 9am operations rollup (campaign, portfolio, research).',
    cron_expression: '0 9 * * 1',
    job_type: 'chain',
    // The old seed referenced job_config.chain and a 'weekly-operations-review'
    // chain template that was never created, so this job could only fail.
    // Disabled until a real operations-review chain exists.
    job_config: { chain_slug: 'weekly-operations-review' },
    is_enabled: false,
  },
  {
    name: 'Daily Book Library Scan',
    description: 'Daily 3am scan of the book library folders to auto-ingest new books.',
    cron_expression: '0 3 * * *',
    job_type: 'custom',
    job_config: { handler: 'scan_book_library' },
    is_enabled: true,
  },
  {
    name: 'Overlay365 QA',
    description: 'Daily 7am Playwright QA pass across all Overlay365 sites (AgentBrowser).',
    cron_expression: '0 7 * * *',
    job_type: 'custom',
    job_config: { handler: 'run_overlay_qa' },
    is_enabled: true,
  },
  {
    name: 'GitHub Awesome Weekly Scan',
    description: 'Weekly Sunday 6am tool-intake scan of the Github Awesome channel (latest GitHub Trending Weekly video → transcript → Dev-Brain /api/intake → .draymond/tool-intake.json + kairos/hypotheses).',
    cron_expression: '0 6 * * 0',
    job_type: 'custom',
    job_config: { handler: 'github_awesome_scan' },
    is_enabled: true,
  },
  {
    name: 'Fleet Duty Sync',
    description: 'Hourly check of the on-duty roster (always-on / shift / on-call).',
    cron_expression: '0 * * * *',
    job_type: 'custom',
    job_config: { handler: 'fleet_duty_sync' },
    is_enabled: true,
  },
  {
    name: 'News Digest',
    description: 'Daily 6am ingest of news APIs (current information for the fleet).',
    cron_expression: '0 6 * * *',
    job_type: 'custom',
    job_config: { handler: 'ingest_news' },
    is_enabled: true,
  },
  {
    name: 'Self-Learning Loop',
    description: 'Nightly lesson distillation from outcomes (QA/jobs/incidents).',
    cron_expression: '30 0 * * *',
    job_type: 'custom',
    job_config: { handler: 'self_learning_loop' },
    is_enabled: true,
  },
  {
    name: 'Self-Repair Check',
    description: 'Hourly failure scan + safe auto-repairs; escalates unknowns to on-call.',
    cron_expression: '15 * * * *',
    job_type: 'custom',
    job_config: { handler: 'self_repair_check' },
    is_enabled: true,
  },
  {
    name: 'Night Mode R&D',
    description: 'Overnight research + dev planning from the news digest + backlog.',
    cron_expression: '0 1 * * *',
    job_type: 'custom',
    job_config: { handler: 'rd_night' },
    is_enabled: true,
  },
  {
    name: 'Evening Marketing Prep',
    description: 'Each evening, the marketing team builds next-day content/tools.',
    cron_expression: '0 20 * * *',
    job_type: 'chain',
    // 'marketing-pulse' was never a defined chain template; point at the real
    // marketing chain so this job actually runs.
    job_config: { chain_slug: 'daily-marketing-run' },
    is_enabled: true,
  },
  {
    name: 'Agent Avatar Generation',
    description: 'Generate agent portrait photos via the image-generation skill.',
    cron_expression: '0 4 * * 0',
    job_type: 'custom',
    job_config: { handler: 'generate_agent_avatars' },
    is_enabled: true,
  },
  {
    name: 'Roster Benchmark',
    description: 'Deep-score pictured agents\' repos (RepoRank/Grader) and queue the weakest for self-learning.',
    cron_expression: '30 6 * * *',
    job_type: 'custom',
    job_config: { handler: 'benchmark_roster' },
    is_enabled: true,
  },
  {
    name: 'Market Data Snapshot',
    description: 'Daily free-API market/research snapshot (crypto, papers) for the fleet.',
    cron_expression: '0 7 * * *',
    job_type: 'custom',
    job_config: { handler: 'fetch_market_data' },
    is_enabled: true,
  },
  {
    name: 'Morning Recap (email)',
    description: 'Morning workplace recap email + Open-Chat: money, issues, insights, upgrades.',
    cron_expression: '5 8 * * *',
    job_type: 'custom',
    job_config: { handler: 'phase_recap', phase: 'morning' },
    is_enabled: true,
  },
  {
    name: 'Midday Recap (email)',
    description: 'Midday workplace recap email + Open-Chat.',
    cron_expression: '5 12 * * *',
    job_type: 'custom',
    job_config: { handler: 'phase_recap', phase: 'midday' },
    is_enabled: true,
  },
  {
    name: 'Evening Recap (email)',
    description: 'Evening workplace recap email + Open-Chat.',
    cron_expression: '5 20 * * *',
    job_type: 'custom',
    job_config: { handler: 'phase_recap', phase: 'evening' },
    is_enabled: true,
  },
  {
    name: 'Evening Call Recap',
    description: 'Evening shift recap — Open-Chat calls you with the day\u2019s summary.',
    cron_expression: '30 20 * * *',
    job_type: 'custom',
    job_config: { handler: 'evening_call_recap' },
    is_enabled: true,
  },
  {
    name: 'Night Recap (email)',
    description: 'Night workplace recap email + Open-Chat.',
    cron_expression: '5 0 * * *',
    job_type: 'custom',
    job_config: { handler: 'phase_recap', phase: 'night' },
    is_enabled: true,
  },
  {
    name: 'Token Rotation Check',
    description: 'Daily provider budget/rate health — rotate keys before exhaustion.',
    cron_expression: '0 11 * * *',
    job_type: 'custom',
    job_config: { handler: 'rotate_tokens' },
    is_enabled: true,
  },
  {
    name: 'Repair Team (failed jobs)',
    description: 'Hourly — scan failed jobs and deploy coding/skill agents to repair them.',
    cron_expression: '5 * * * *',
    job_type: 'custom',
    job_config: { handler: 'repair_failed_jobs' },
    is_enabled: true,
  },
  {
    name: 'Brain Decision Cycle',
    description: 'Every 30min — Draymond consults the deterministic brain reasoning engine, aligned to the agenda, and routes hiccups to the repair/coding teams.',
    cron_expression: '*/30 * * * *',
    job_type: 'custom',
    job_config: { handler: 'brain_decision_cycle' },
    is_enabled: true,
  },
  {
    name: 'Agent Heartbeat Sweep',
    description: 'Every 15min — ping every roster service health endpoint and record real liveness (no more permanent "unknown").',
    cron_expression: '*/15 * * * *',
    job_type: 'custom',
    job_config: { handler: 'agent_heartbeat_sweep' },
    is_enabled: true,
  },
  {
    name: 'Service Health Repair',
    description: 'Hourly — probe ecosystem services and auto-start any that are down (BookBridge, brain, hemp stack, ...).',
    cron_expression: '20 * * * *',
    job_type: 'custom',
    job_config: { handler: 'service_health_repair' },
    is_enabled: true,
  },
  {
    name: 'Free-API Key Audit',
    description: 'Daily 9am — audit which free-API keys are configured (never the values) and feed the acquisition list to self-learning.',
    cron_expression: '0 9 * * *',
    job_type: 'custom',
    job_config: { handler: 'api_key_audit' },
    is_enabled: true,
  },
  {
    name: 'Treasurer Cash Pulse',
    description: 'Daily 8am — pull settled Stripe charges, update revenue to date, feed the business pipeline + recaps.',
    cron_expression: '0 8 * * *',
    job_type: 'custom',
    job_config: { handler: 'treasury_pulse' },
    is_enabled: true,
  },
  {
    name: 'Mission Pipeline Sync',
    description: 'Daily 6am — reconcile opportunity stages, flag stale leads, compute mission KPIs.',
    cron_expression: '0 6 * * *',
    job_type: 'custom',
    job_config: { handler: 'mission_pipeline_sync' },
    is_enabled: true,
  },
  {
    name: 'Mission Strategy Review',
    description: 'Weekly Monday 8am — pipeline + settled revenue vs target, emailed strategy memo.',
    cron_expression: '0 8 * * 1',
    job_type: 'custom',
    job_config: { handler: 'mission_strategy_review' },
    is_enabled: true,
  },
  {
    name: 'MaaS Monthly Cycle',
    description: 'Weekly Monday 9am \u2014 run the MaaS delivery chain for each active MaaS client.',
    cron_expression: '0 9 * * 1',
    job_type: 'custom',
    job_config: { handler: 'mission_run_maas_cycle' },
    is_enabled: true,
  },
  {
    name: 'Kairos Scan',
    description: 'Every 15min \u2014 proactive fleet scan: detectors surface kairos moments (down monitors, failed jobs, stale leads, revenue shortfall, budget pressure, weak agents, repair loops, stale heartbeats).',
    cron_expression: '*/15 * * * *',
    job_type: 'custom',
    job_config: { handler: 'kairos_scan' },
    is_enabled: true,
  },
  {
    name: 'Dream Cycle',
    description: 'Nightly 2am \u2014 AutoDream 4-phase memory consolidation (gated: 24h + 5 sessions + idle).',
    cron_expression: '0 2 * * *',
    job_type: 'custom',
    job_config: { handler: 'dream_cycle' },
    is_enabled: true,
  },
  {
    name: 'Ultraplan Process',
    description: 'Nightly 2:30am \u2014 run the deep-planning pass on queued ultraplans.',
    cron_expression: '30 2 * * *',
    job_type: 'custom',
    job_config: { handler: 'ultraplan_process' },
    is_enabled: true,
  },
  {
    name: 'On-Device Ops Dispatch',
    description: 'Daily 9:45am — enqueue a phone ops task (morning snapshot) for the Open-Chat worker.',
    cron_expression: '45 9 * * *',
    job_type: 'custom',
    job_config: {
      handler: 'dispatch_worker_tasks',
      tasks: [
        {
          skill_pack_id: 'on_device_ops:1.0.0',
          payload: { action: 'morning_snapshot', note: 'Capture a phone state snapshot and report the foreground app + notifications.' },
        },
      ],
    },
    is_enabled: true,
  },
  {
    name: 'Systemic Interconnect',
    description: 'Weekly Sunday 5am — full one-shot interconnection: seed agenda + knowledge graph + consolidate.',
    cron_expression: '0 5 * * 0',
    job_type: 'custom',
    job_config: { handler: 'systemic_interconnect' },
    is_enabled: true,
  },
  {
    name: 'Deep Research Weekly',
    description: 'Weekly Monday 9:30am — run the deep research brief chain for the week ahead.',
    cron_expression: '30 9 * * 1',
    job_type: 'chain',
    job_config: { chain_slug: 'research-brief-delivery' },
    is_enabled: true,
  },
  {
    name: 'Weekend Ops Review',
    description: 'Saturday 8am — full ecosystem audit + upgrade queue review for the weekend.',
    cron_expression: '0 8 * * 6',
    job_type: 'custom',
    job_config: { handler: 'benchmark_upgrade_review' },
    is_enabled: true,
  },
  {
    name: 'Weekend Self-Repair Deep Dive',
    description: 'Saturday 9am — deep failure scan + repair of any backlogged failures before Monday.',
    cron_expression: '0 9 * * 6',
    job_type: 'custom',
    job_config: { handler: 'repair_failed_jobs' },
    is_enabled: true,
  },
  {
    name: 'Benchmark Olympics Discovery Loop',
    description: 'Every 6h — autonomous research loop: probe the fleet, mature discovery hypotheses, surface quick-upgrade insights, and auto-fix weak components via the repair team.',
    cron_expression: '0 */6 * * *',
    job_type: 'custom',
    job_config: { handler: 'benchmark_discovery_loop', iterations: 2 },
    is_enabled: true,
  },
  {
    name: 'Daily Repair Shift',
    description: 'Daily 6pm — the repair team shift: code-review audit, fix + upgrade weak ecosystem components, benchmark the improvements, and run self-learning so each day starts smarter.',
    cron_expression: '0 18 * * *',
    job_type: 'custom',
    job_config: { handler: 'repair_shift' },
    is_enabled: true,
  },
  {
    name: 'Research Breakthrough Grading',
    description: 'Daily 6:30pm — grade CureMind/BB-Tech research output for breakthrough potential, surface trends/insights/discoveries, and feed the self-learning loop so the research system consistently gets smarter.',
    cron_expression: '30 18 * * *',
    job_type: 'custom',
    job_config: { handler: 'research_grade_loop' },
    is_enabled: true,
  },
  {
    name: 'Synthesis Midday',
    description: 'Daily 12pm — midday synthesis pass over research sectors: evaluate material-density thresholds and run the combination-study phase for sectors ready, so breakthroughs schedule faster than the nightly self-learning loop alone.',
    cron_expression: '0 12 * * *',
    job_type: 'custom',
    job_config: { handler: 'synthesis_midday' },
    is_enabled: true,
  },
  {
    name: 'ClinVar Variant Surveillance',
    description: 'Daily 8am — query real NCBI ClinVar (via BioComposable) for watched variants, flag reclassifications, and feed consensus discoveries into the self-learning loop.',
    cron_expression: '0 8 * * *',
    job_type: 'custom',
    job_config: { handler: 'clinvar_surveillance' },
    is_enabled: true,
  },
  {
    name: 'Science Paper Refresh',
    description: 'Weekly Monday 3am — refresh the OpenAlex/PubMed literature cache for every active science goal so research grounding never goes stale.',
    cron_expression: '0 3 * * 1',
    job_type: 'custom',
    job_config: { handler: 'science_paper_refresh' },
    is_enabled: true,
  },
  {
    name: 'Science Publication Loop',
    description: 'Nightly 3:10am — publish frontier/promising graded discoveries to Overlay Global Lens and drain the publication→self-learning feed.',
    cron_expression: '10 3 * * *',
    job_type: 'custom',
    job_config: { handler: 'science_publication_loop' },
    is_enabled: true,
  },
  {
    name: 'NBA Stats Ingest',
    description: 'Nightly 4:30am — run the sports_science metrics pipeline over NBA dataset profiles + optional live game-log fetch, and refresh NBA research evidence.',
    cron_expression: '30 4 * * *',
    job_type: 'custom',
    job_config: { handler: 'nba_stats_ingest' },
    is_enabled: true,
  },
  {
    name: 'Sports Bankroll Pulse',
    description: 'Daily 8:15am — surface Sports Steve bankroll/P&L/bets into Draymond state so the treasury and business pipeline see real betting revenue.',
    cron_expression: '15 8 * * *',
    job_type: 'custom',
    job_config: { handler: 'bankroll_pulse' },
    is_enabled: true,
  },
  {
    name: 'Finance Strategy Brief',
    description: 'Daily 8:15am — pull the finance-connect daily strategy brief for the treasurer/strategist (the 08:15 agenda step).',
    cron_expression: '15 8 * * *',
    job_type: 'custom',
    job_config: { handler: 'finance_strategy_brief' },
    is_enabled: true,
  },
  {
    name: 'Finance Goals Sync',
    description: 'Daily 8:45am — sync capability-grounded finance goals into draymond_goals (the 08:45 agenda step).',
    cron_expression: '45 8 * * *',
    job_type: 'custom',
    job_config: { handler: 'finance_goals_sync' },
    is_enabled: true,
  },
  {
    name: 'Mission Workflow Sync',
    description: 'Daily 9:30am — mission pipeline + revenue-vs-target sync (the 09:30 agenda step).',
    cron_expression: '30 9 * * *',
    job_type: 'custom',
    job_config: { handler: 'wf_mission_sync' },
    is_enabled: true,
  },
  {
    name: 'Systemic Consolidate',
    description: 'Daily 5:30am — distill lessons, persist memory, and align agenda-goal progress (consolidation run separate from the weekly full interconnect).',
    cron_expression: '30 5 * * *',
    job_type: 'custom',
    job_config: { handler: 'systemic_consolidate' },
    is_enabled: true,
  },
  {
    name: 'Free Model Daily Assignment',
    description: 'Daily 4:00am UTC — probe openrouter + opencode free models, update model-routing.json, patch ecosystem patch config, and log assignment.',
    cron_expression: '0 4 * * *',
    job_type: 'custom',
    job_config: { handler: 'free_model_daily_assignment' },
    is_enabled: true,
  },
];

/**
 * Create the seeded default jobs if they are not already present.
 * Best-effort: failures are logged and swallowed so the caller never breaks.
 */
export async function seedBasicJobs(): Promise<number> {
  let created = 0;
  for (const job of BASIC_JOBS) {
    try {
      const existing = await getJob(job.name);
      if (!existing) {
        await createJob(job);
        created += 1;
      }
    } catch (err) {
      console.error(`[Draymond Scheduler] Failed to seed job "${job.name}":`, err);
    }
  }
  return created;
}
