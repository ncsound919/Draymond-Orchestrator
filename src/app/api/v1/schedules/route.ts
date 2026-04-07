/**
 * /api/v1/schedules — Open Chat schedule management proxy
 * GET   — List scheduled jobs
 * PATCH — Enable/disable a scheduled job
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { listJobs, enableJob, disableJob, getJob } from '@/lib/draymond/scheduler';

export const dynamic = 'force-dynamic';

const VALID_JOB_TYPES = ['chain', 'health_check', 'notification', 'custom'] as const;

// GET — list scheduled jobs
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);

    const filters: Record<string, unknown> = {};

    const isEnabledParam = url.searchParams.get('is_enabled');
    if (isEnabledParam !== null) {
      filters.is_enabled = isEnabledParam === 'true';
    }

    const jobType = url.searchParams.get('job_type');
    if (jobType) {
      if (!VALID_JOB_TYPES.includes(jobType as typeof VALID_JOB_TYPES[number])) {
        return NextResponse.json(
          { ok: false, error: `Invalid job_type. Must be one of: ${VALID_JOB_TYPES.join(', ')}` },
          { status: 400 },
        );
      }
      filters.job_type = jobType;
    }

    const limitParam = url.searchParams.get('limit');
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) {
        filters.limit = Math.min(parsed, 200);
      }
    }

    const jobs = await listJobs(filters);
    return NextResponse.json({ ok: true, schedules: jobs });
  } catch (err) {
    console.error('[API /api/v1/schedules GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// PATCH — enable or disable a scheduled job
export async function PATCH(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    id?: string;
    action?: 'enable' | 'disable';
  }>(request);
  if (parseError) return parseError;

  try {
    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing required field: id' }, { status: 400 });
    }
    if (!body.action || !['enable', 'disable'].includes(body.action)) {
      return NextResponse.json({ ok: false, error: 'action must be "enable" or "disable"' }, { status: 400 });
    }

    const job = body.action === 'enable' ? await enableJob(body.id) : await disableJob(body.id);
    return NextResponse.json({ ok: true, schedule: job });
  } catch (err) {
    console.error('[API /api/v1/schedules PATCH]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
