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
import { runDueJobs, seedBasicJobs, listJobs } from '@/lib/draymond/scheduler';
import { checkAllAgentHealth } from '@/lib/draymond/index';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { repairFailedJob } from '@/lib/draymond/repair-team';
import { updateJob } from '@/lib/draymond/scheduler';
import { drainOpenGaps, dispatchToResearch } from '@/lib/science/researchEscalation';
import { dispatchProjectRepair } from '@/lib/draymond/repair-crew';
import { publishIssueNotification } from '@/lib/draymond/ntfy';
import { isOnCooldown } from '@/lib/draymond/workflow-budget';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const startTime = Date.now();

  // -- Ensure the scheduled job set exists (idempotent) ------------------
  let seededJobs = 0;
  try {
    seededJobs = await seedBasicJobs();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron] seedBasicJobs failed:', message);
  }

  // -- Execute due jobs ------------------------------------------------
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

  // -- DEPLOY REPAIR TEAM ON FAILED JOBS -------------------------------
  // For each failed job: classify -> research via OmniResearch -> audit via OpenHub -> repair via Axiom.
  // A failed job keeps last_run_status='failed' until it next runs, so without a
  // per-job cooldown this pipeline would re-dispatch deep research + Axiom on
  // every tick (minute). Gate it with the shared persisted cooldown.
  let repairResults: Array<{ job: string; repair: unknown; research?: unknown; audit?: unknown; axiom?: unknown }> = [];
  let repairSkipped = 0;
  const repairCooldownMs = Number(process.env.DRAYMOND_CRON_REPAIR_COOLDOWN_M ?? 360) * 60_000;
  try {
    const failedJobs = (await listJobs()).filter((j) => j.last_run_status === 'failed' && j.is_enabled);
    console.log(`[Cron] Found ${failedJobs.length} failed jobs to process`);

    for (const job of failedJobs.slice(0, 10)) { // Process up to 10 failed jobs per cron run
      if (Number.isFinite(repairCooldownMs) && repairCooldownMs > 0 && isOnCooldown('cron-repair', job.id, repairCooldownMs)) {
        repairSkipped++;
        continue;
      }
      try {
        console.log(`[Cron] Processing failed job: ${job.name} (${job.job_type})`);
        
        // Step 1: Dispatch to OmniResearch for deep research on the failure
        const researchResult = await dispatchToResearch({
          gap_id: `job-failure-${job.id}`,
          kind: 'job_failure',
          title: `Failed job: ${job.name}`,
          detail: `Job ${job.name} (${job.job_type}) failed: ${job.last_error ?? 'unknown error'}`,
          evidence_tier: 'E2',
          severity: 4,
          detected_at: new Date().toISOString(),
          payload: {
            jobId: job.id,
            jobName: job.name,
            jobType: job.job_type,
            jobConfig: job.job_config,
            lastError: job.last_error,
            runCount: job.run_count,
            failCount: job.fail_count,
          },
        } as any);
        console.log(`[Cron] Research dispatched for ${job.name}:`, researchResult);

        // Step 2: Also run the standard repair team for immediate fixes
        const repairReport = await repairFailedJob(
          { id: job.id, name: job.name, job_type: job.job_type, job_config: job.job_config ?? {} },
          job.last_error ?? 'unknown error',
          { updateJobConfig: (id, config) => updateJob(id, { job_config: config }) },
          [],
          { immediate: true }
        );
        console.log(`[Cron] Repair report for ${job.name}:`, repairReport.action);

        // Step 3: If repair was handed off or escalated, dispatch Axiom project repair
        let axiomResult = null;
        if (repairReport.action === 'handed-off' || repairReport.action === 'escalated') {
          try {
            const project = await dispatchProjectRepair({ job, error: job.last_error ?? 'unknown error', lessons: [] });
            if (project) {
              axiomResult = project;
              console.log(`[Cron] Axiom project repair dispatched for ${job.name}:`, project.action);
            }
          } catch (e) {
            console.error(`[Cron] Axiom dispatch failed for ${job.name}:`, e);
          }
        }

        // Step 4: Notify OpenHub for audit (via ntfy or direct API)
        try {
          await publishIssueNotification({
            title: `Draymond · Failed Job: ${job.name}`,
            message: `Job ${job.name} failed. Research: ${researchResult.ok ? 'dispatched' : 'queued'}. Repair: ${repairReport.action}. ${axiomResult ? `Axiom: ${axiomResult.action}` : 'No Axiom dispatch'}`,
            priority: repairReport.action === 'fixed' ? 2 : 4,
            tags: ['gear', 'warning'],
          });
        } catch {}

        repairResults.push({ job: job.name, repair: repairReport, research: researchResult, audit: { notified: true }, axiom: axiomResult });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Cron] Failed to process ${job.name}:`, message);
        errors.push(`repair:${job.name}: ${message}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron] repair team failed:', message);
    errors.push(`repair team: ${message}`);
  }

  // -- Drain OmniResearch gap queue (science gaps) ---------------------
  let gapDrain = { ok: true, dispatched: 0, queued: 0, errors: [] as string[] };
  try {
    gapDrain = await drainOpenGaps(5);
    console.log('[Cron] Gap drain:', gapDrain);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron] drainOpenGaps failed:', message);
    errors.push(`gapDrain: ${message}`);
  }

  // -- Run agent health checks -----------------------------------------
  try {
    healthResults = await checkAllAgentHealth();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Cron] checkAllAgentHealth failed:', message);
    errors.push(`checkAllAgentHealth: ${message}`);
  }

  // -- Response --------------------------------------------------------
  const durationMs = Date.now() - startTime;
  const succeeded = jobResults.filter((r) => r.status === 'success').length;
  const failed = jobResults.filter((r) => r.status === 'failed').length;

  return NextResponse.json({
    ok: errors.length === 0,
    timestamp: new Date().toISOString(),
    duration_ms: durationMs,
    seeded_jobs: seededJobs,
    repair_results: repairResults,
    repair_skipped: repairSkipped,
    gap_drain: gapDrain,
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
