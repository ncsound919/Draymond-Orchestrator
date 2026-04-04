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
import { runDueJobs } from '@/lib/draymond/scheduler';
import { checkAllAgentHealth } from '@/lib/draymond/index';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // ── Auth check ──────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[Cron] CRON_SECRET env var is not set');
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token !== cronSecret) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
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
