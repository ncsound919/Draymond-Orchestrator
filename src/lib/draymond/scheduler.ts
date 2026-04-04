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

// ============================================================================
// TYPES
// ============================================================================

export type JobType = 'chain' | 'health_check' | 'notification' | 'custom';

export type JobRunStatus = 'never' | 'running' | 'success' | 'failed' | 'skipped';

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

/** List scheduled jobs with optional filters. */
export async function listJobs(filters?: JobListFilters): Promise<ScheduledJob[]> {
  const supabase = createDraymondAdminClient();
  const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200);

  let query = supabase
    .from('draymond_scheduled_jobs')
    .select('*')
    .order('created_at', { ascending: false })
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
      timeout_seconds: input.timeout_seconds ?? 300,
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

// ============================================================================
// JOB EXECUTION ENGINE
// ============================================================================

const NOTIFICATION_RECIPIENT = process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER ?? '';

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
      return result;
    }

    case 'health_check': {
      const reports = await checkAllAgentHealth();
      return reports;
    }

    case 'notification': {
      const payload = config.payload as {
        channel?: string;
        recipient?: string;
        subject?: string;
        body?: string;
        type?: string;
        priority?: string;
      };

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

    case 'custom': {
      const handler = config.handler as string | undefined;
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
export async function runDueJobs(): Promise<JobRunResult[]> {
  const supabase = createDraymondAdminClient();
  const now = new Date();
  const results: JobRunResult[] = [];
  const recipient = getNotificationRecipient();

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

  // 2. Execute each due job with atomic claim
  for (const raw of dueJobs) {
    const job = raw as ScheduledJob;

    // Atomic claim: only mark as running if still not running.
    // If another worker already claimed this job, the update returns 0 rows.
    const { data: claimed, error: claimError } = await supabase
      .from('draymond_scheduled_jobs')
      .update({ last_run_status: 'running' })
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

    try {
      // Execute the job
      const output = await executeJobByType(job);

      const durationMs = Date.now() - startTime;

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
          run_count: job.run_count + 1,
          next_run_at: nextRunAt,
        })
        .eq('id', job.id);

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
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Compute next run even on failure
      const nextRunAt = getNextRunTime(job.cron_expression, now).toISOString();

      // Update failure state
      await supabase
        .from('draymond_scheduled_jobs')
        .update({
          last_run_at: now.toISOString(),
          last_run_status: 'failed',
          last_run_duration_ms: durationMs,
          last_error: errorMessage,
          run_count: job.run_count + 1,
          fail_count: job.fail_count + 1,
          next_run_at: nextRunAt,
        })
        .eq('id', job.id);

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
            `Job "${job.name}" (${job.job_type}) failed after ${durationMs}ms.\n\nError: ${errorMessage}\n\nFail count: ${job.fail_count + 1} / Run count: ${job.run_count + 1}`,
            'agent_failure',
            { priority: 'high', metadata: { job_id: job.id, duration_ms: durationMs, error: errorMessage } }
          );
        } catch (notifyErr) {
          console.error(`[Draymond Scheduler] Failed to send failure notification for "${job.name}":`, notifyErr);
        }
      }
    }
  }

  return results;
}
