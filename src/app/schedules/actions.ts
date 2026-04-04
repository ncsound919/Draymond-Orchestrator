'use server';

import { createJob, enableJob, disableJob, deleteJob } from '@/lib/draymond/scheduler';
import type { ScheduledJobInsert } from '@/lib/draymond/scheduler';
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
  // Runtime validation
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
    throw new Error(`Invalid job type: ${data.job_type}`);
  }
  if (data.description !== undefined && typeof data.description !== 'string') {
    throw new Error('Description must be a string');
  }

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

export async function toggleJob(id: string, enable: boolean) {
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
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid job ID');
  }

  await deleteJob(id);
  revalidatePath('/schedules');
}
