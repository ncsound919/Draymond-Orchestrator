// ============================================================================
// GET /api/cron — Autonomous Scheduler Endpoint
// ============================================================================
// Called by Vercel Cron or an external cron service on a schedule.
// Executes all due scheduled jobs and runs agent health checks.
//
// Protected by CRON_SECRET — the caller must send:
//   Authorization: Bearer <CRON_SECRET>
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { runDueJobs, seedBasicJobs } from '@/lib/draymond/scheduler';
import { checkAllAgentHealth } from '@/lib/draymond/index';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const startTime = Date.now();

  // ── Ensure the scheduled job set exists (idempotent) ──────────────────
  let seededJobs = 0;
  try {
    seededJobs = await seedBasicJobs();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron] seedBasicJobs failed:', message);
  }

  // ── Execute due jobs ────────────────────────────────────────────────
  const errors: string[] = [];
  let jobResults: Awaited<ReturnType<typeof runDueJobs>> = [];
  let healthResults: unknown = null;

  try {
    jobResults = await runDueJobs();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron] runDueJobs failed:', message);
    errors.push(`runDueJobs: ${message}`);
  }

  // ── Deploy the repair team on any failed jobs ──────────────────────────
  // The dedicated "Repair Team (failed jobs)" scheduler job does the deep
  // repair loop hourly. Here we only run a lightweight pass for jobs that
  // JUST failed this tick, so the cron response stays fast (the old inline
  // loop made /api/cron take 120s+ and time out).
  let repair: { failed: number; fixed: number } | null = null;
  try {
    const { listJobs, updateJob } = await import('@/lib/draymond/scheduler');
    const { repairFailedJob } = await import('@/lib/draymond/repair-team');
    const failed = (await listJobs()).filter((j) => j.last_run_status === 'failed');
    let fixed = 0;
    for (const j of failed.slice(0, 5)) {
      const report = await repairFailedJob(
        { id: j.id, name: j.name, job_type: j.job_type, job_config: j.job_config ?? {} },
        j.last_error ?? 'unknown error',
        { updateJobConfig: (id, config) => updateJob(id, { job_config: config }) },
      );
      if (report.action === 'fixed') fixed++;
    }
    repair = { failed: failed.length, fixed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron] repair team failed:', message);
  }

  // ── Run agent health checks ─────────────────────────────────────────
  try {
    healthResults = await checkAllAgentHealth();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron] checkAllAgentHealth failed:', message);
    errors.push(`checkAllAgentHealth: ${message}`);
  }

  // ── Response ────────────────────────────────────────────────────────
  const durationMs = Date.now() - startTime;
  const succeeded = jobResults.filter((r) => r.status === 'success').length;
  const failed = jobResults.filter((r) => r.status === 'failed').length;

  return NextResponse.json({
    ok: errors.length === 0,
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    seeded_jobs: seededJobs,
    repair: repair,
    jobs: {
      total: jobResults.length,
      succeeded,
      failed,
      results: jobResults,
    },
    health: healthResults,
    errors: errors.length > 0 ? errors : undefined,
  });
}
