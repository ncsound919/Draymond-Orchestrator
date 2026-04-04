// ============================================================================
// POST /api/seed — Business Automation Seed Endpoint
// ============================================================================
// Seeds all business automation entities, chain templates, and scheduled jobs
// into the Draymond orchestration tables.
//
// Protected by CRON_SECRET — the caller must send:
//   Authorization: Bearer <CRON_SECRET>
//
// Idempotent: uses upserts, safe to call repeatedly.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { seedBusinessAutomation } from '@/lib/draymond/business-chains';
import { seedAgentMonitors } from '@/lib/draymond/monitors';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // ── Auth check ──────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[Seed] CRON_SECRET env var is not set');
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

  // ── Run seed ────────────────────────────────────────────────────────
  try {
    const result = await seedBusinessAutomation();
    const monitorResult = await seedAgentMonitors();
    const durationMs = Date.now() - startTime;

    const allErrors = [
      ...result.errors,
      ...monitorResult.errors,
    ];

    return NextResponse.json({
      ok: allErrors.length === 0,
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      entities: result.entities,
      chains: result.chains,
      jobs: result.jobs,
      monitors: {
        created: monitorResult.created,
        skipped: monitorResult.skipped,
        names: monitorResult.names,
      },
      errors: allErrors.length > 0 ? allErrors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Seed] Seed operation failed:', message);

    return NextResponse.json(
      {
        ok: false,
        error: message,
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
