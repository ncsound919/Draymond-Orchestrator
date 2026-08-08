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
import { seedSkillPacks } from '@/lib/draymond/skill-packs';
import { interconnectSystem } from '@/lib/draymond/systemic';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const startTime = Date.now();

  // ── Run seed ────────────────────────────────────────────────────────
  try {
    const result = await seedBusinessAutomation();
    const monitorResult = await seedAgentMonitors();
    const skillPackResult = await seedSkillPacks();
    const systemic = await interconnectSystem();
    const durationMs = Date.now() - startTime;

    const allErrors = [
      ...result.errors,
      ...monitorResult.errors,
      ...skillPackResult.errors,
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
      skill_packs: {
        seeded: skillPackResult.seeded,
        names: skillPackResult.names,
      },
      systemic: {
        agenda: systemic.agenda,
        graph: systemic.graph,
        consolidation: systemic.consolidation,
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
