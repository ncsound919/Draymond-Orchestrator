'use server';

import { createJob, enableJob, disableJob, deleteJob, updateJob, runJobNow, runDueJobs, listJobs, type ScheduledJobInsert, type ScheduledJobUpdate } from '@/lib/draymond/scheduler';
import { requireDraymondActionAuth } from '@/lib/draymond/auth';
import { revalidatePath } from 'next/cache';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_JOB_TYPES = ['chain', 'health_check', 'notification', 'custom'] as const;
type JobType = typeof VALID_JOB_TYPES[number];

/** Basic cron expression format validation (5 fields). */
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  // Each field must contain only digits, *, /, -, and comma
  return parts.every((p) => /^[\d*\/,\-]+$/.test(p));
}

function validateJobInput(data: { name?: unknown; cron_expression?: unknown; job_type?: unknown; description?: unknown }) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid input');
  }
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    throw new Error('Name is required');
  }
  if (data.name.length > 200) {
    throw new Error('Name must be 200 characters or fewer');
  }
  if (!data.cron_expression || typeof data.cron_expression !== 'string') {
    throw new Error('Cron expression is required');
  }
  if (!isValidCron(data.cron_expression)) {
    throw new Error('Invalid cron expression format (expected 5 space-separated fields)');
  }
  if (!data.job_type || !VALID_JOB_TYPES.includes(data.job_type as JobType)) {
    throw new Error(`Invalid job type: ${String(data.job_type)}`);
  }
  if (data.description !== undefined && typeof data.description !== 'string') {
    throw new Error('Description must be a string');
  }
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

export async function createScheduledJob(data: {
  name: string;
  description?: string;
  cron_expression: string;
  job_type: 'chain' | 'health_check' | 'notification' | 'custom';
  job_config?: Record<string, unknown>;
  is_enabled?: boolean;
}) {
  await requireDraymondActionAuth();
  validateJobInput(data);

  const job = await createJob({
    name: data.name.trim(),
    description: data.description?.trim() || undefined,
    cron_expression: data.cron_expression.trim(),
    job_type: data.job_type,
    job_config: data.job_config ?? {},
    is_enabled: data.is_enabled ?? true,
  } as ScheduledJobInsert);

  revalidatePath('/schedules');
  return job;
}

export async function updateScheduledJob(id: string, data: {
  name?: string;
  description?: string;
  cron_expression?: string;
  job_type?: 'chain' | 'health_check' | 'notification' | 'custom';
  job_config?: Record<string, unknown>;
  is_enabled?: boolean;
  max_retries?: number;
  timeout_seconds?: number;
  notify_on_failure?: boolean;
  notify_on_success?: boolean;
}) {
  await requireDraymondActionAuth();
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid job ID');
  }
  if (data.cron_expression !== undefined) {
    if (typeof data.cron_expression !== 'string' || !isValidCron(data.cron_expression)) {
      throw new Error('Invalid cron expression format (expected 5 space-separated fields)');
    }
  }
  if (data.job_type !== undefined && !VALID_JOB_TYPES.includes(data.job_type as JobType)) {
    throw new Error(`Invalid job type: ${data.job_type}`);
  }

  const updates: ScheduledJobUpdate = {};
  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.description !== undefined) updates.description = data.description.trim() || undefined;
  if (data.cron_expression !== undefined) updates.cron_expression = data.cron_expression.trim();
  if (data.job_type !== undefined) updates.job_type = data.job_type;
  if (data.job_config !== undefined) updates.job_config = data.job_config;
  if (data.is_enabled !== undefined) updates.is_enabled = data.is_enabled;
  if (data.max_retries !== undefined) updates.max_retries = data.max_retries;
  if (data.timeout_seconds !== undefined) updates.timeout_seconds = data.timeout_seconds;
  if (data.notify_on_failure !== undefined) updates.notify_on_failure = data.notify_on_failure;
  if (data.notify_on_success !== undefined) updates.notify_on_success = data.notify_on_success;

  const job = await updateJob(id, updates);
  revalidatePath('/schedules');
  return job;
}

export async function toggleJob(id: string, enable: boolean) {
  await requireDraymondActionAuth();
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid job ID');
  }

  if (enable) {
    await enableJob(id);
  } else {
    await disableJob(id);
  }
  revalidatePath('/schedules');
}

export async function removeJob(id: string) {
  await requireDraymondActionAuth();
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid job ID');
  }

  await deleteJob(id);
  revalidatePath('/schedules');
}

/** Run a job immediately, bypassing its schedule. Returns the run outcome. */
export async function runScheduledJob(id: string) {
  await requireDraymondActionAuth();
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid job ID');
  }
  const result = await runJobNow(id);
  revalidatePath('/schedules');
  return result;
}

/**
 * Catch up missed jobs: run every enabled job whose slot was missed while the
 * server was offline (within the boot catch-up horizon, default 24h). Lets the
 * operator press "Catch up missed" after downtime instead of losing the work.
 */
export async function catchUpMissedJobs() {
  await requireDraymondActionAuth();
  const horizonMs = Number(process.env.DRAYMOND_BOOT_CATCHUP_HORIZON_MS ?? 24 * 60 * 60 * 1000);
  const results = await runDueJobs(new Date(), { catchupMs: horizonMs });
  revalidatePath('/schedules');
  return {
    processed: results.length,
    ran: results.filter((r) => r.status === 'success').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    results: results.slice(0, 50).map((r) => ({
      job_name: r.job_name,
      status: r.status,
      error: r.error ?? null,
      duration_ms: r.duration_ms,
    })),
  };
}

/** Run every currently-failed job once, in one pass. Returns per-job outcomes. */
export async function runAllFailedJobs() {
  await requireDraymondActionAuth();
  const failed = (await listJobs()).filter((j) => j.last_run_status === 'failed');
  const results = [];
  for (const job of failed) {
    try {
      const r = await runJobNow(job.id);
      results.push({ job_name: job.name, status: r.status, error: r.error ?? null });
    } catch (err) {
      results.push({ job_name: job.name, status: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  }
  revalidatePath('/schedules');
  return {
    attempted: failed.length,
    ran: results.filter((r) => r.status === 'success').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}
