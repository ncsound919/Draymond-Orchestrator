// ============================================================================
// /api/jobs — Scheduled Jobs CRUD
// ============================================================================
// Full CRUD for Draymond scheduled jobs. All endpoints require
// Bearer <CRON_SECRET> authentication.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  listJobs,
  createJob,
  updateJob,
  deleteJob,
  enableJob,
  disableJob,
} from '@/lib/draymond/scheduler';
import type {
  ScheduledJobInsert,
  JobListFilters,
} from '@/lib/draymond/scheduler';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

// Valid values for query param validation
const VALID_JOB_TYPES = ['chain', 'health_check', 'notification', 'custom'] as const;
const VALID_RUN_STATUSES = ['never', 'running', 'success', 'failed', 'skipped'] as const;

// Fields allowed in PATCH updates (excluding enable/disable which use action)
const ALLOWED_PATCH_FIELDS = new Set([
  'name',
  'description',
  'cron_expression',
  'job_type',
  'job_config',
  'is_enabled',
]);

// -- GET — List scheduled jobs -----------------------------------------

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);

    const filters: JobListFilters = {};

    const isEnabledParam = url.searchParams.get('is_enabled');
    if (isEnabledParam !== null) {
      filters.is_enabled = isEnabledParam === 'true';
    }

    const jobType = url.searchParams.get('job_type');
    if (jobType) {
      if (!VALID_JOB_TYPES.includes(jobType as typeof VALID_JOB_TYPES[number])) {
        return NextResponse.json(
          { ok: false, error: `Invalid job_type: "${jobType}". Must be one of: ${VALID_JOB_TYPES.join(', ')}` },
          { status: 400 },
        );
      }
      filters.job_type = jobType as JobListFilters['job_type'];
    }

    const lastRunStatus = url.searchParams.get('last_run_status');
    if (lastRunStatus) {
      if (!VALID_RUN_STATUSES.includes(lastRunStatus as typeof VALID_RUN_STATUSES[number])) {
        return NextResponse.json(
          { ok: false, error: `Invalid last_run_status: "${lastRunStatus}". Must be one of: ${VALID_RUN_STATUSES.join(', ')}` },
          { status: 400 },
        );
      }
      filters.last_run_status = lastRunStatus as JobListFilters['last_run_status'];
    }

    const limitParam = url.searchParams.get('limit');
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        filters.limit = Math.min(parsed, 200); // Cap at 200
      }
    }

    const jobs = await listJobs(filters);
    return NextResponse.json({ ok: true, jobs });
  } catch (err) {
    console.error('[API /jobs GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// -- POST — Create a scheduled job ------------------------------------

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<ScheduledJobInsert>(request);
  if (parseError) return parseError;

  try {
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: name' },
        { status: 400 },
      );
    }
    if (!body.cron_expression || typeof body.cron_expression !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: cron_expression' },
        { status: 400 },
      );
    }
    if (!body.job_type || !VALID_JOB_TYPES.includes(body.job_type as typeof VALID_JOB_TYPES[number])) {
      return NextResponse.json(
        { ok: false, error: `Missing or invalid field: job_type. Must be one of: ${VALID_JOB_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    const job = await createJob(body);
    return NextResponse.json({ ok: true, job }, { status: 201 });
  } catch (err) {
    console.error('[API /jobs POST]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// -- PATCH — Update, enable, or disable a scheduled job ---------------

export async function PATCH(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<Record<string, unknown>>(request);
  if (parseError) return parseError;

  try {
    const id = body.id;
    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: id' },
        { status: 400 },
      );
    }

    const action = body.action;

    let job;

    if (action === 'enable') {
      job = await enableJob(id);
    } else if (action === 'disable') {
      job = await disableJob(id);
    } else {
      // Filter to only allowed fields
      const updates: Record<string, unknown> = {};
      for (const key of Object.keys(body)) {
        if (key === 'id' || key === 'action') continue;
        if (ALLOWED_PATCH_FIELDS.has(key)) {
          updates[key] = body[key];
        }
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { ok: false, error: 'No valid fields to update' },
          { status: 400 },
        );
      }

      job = await updateJob(id, updates);
    }

    return NextResponse.json({ ok: true, job });
  } catch (err) {
    console.error('[API /jobs PATCH]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// -- DELETE — Delete a scheduled job ----------------------------------

export async function DELETE(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    // Support id from JSON body or query param
    let id: string | null = null;

    const url = new URL(request.url);
    id = url.searchParams.get('id');

    if (!id) {
      try {
        const body = (await request.json()) as { id?: string };
        id = typeof body.id === 'string' ? body.id : null;
      } catch {
        // No JSON body — that's fine, we already checked query params
      }
    }

    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: id (query param or body)' },
        { status: 400 },
      );
    }

    await deleteJob(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[API /jobs DELETE]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
