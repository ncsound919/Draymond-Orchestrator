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
import { seedAgentMonitors, disableAbsentServiceMonitors } from '@/lib/draymond/monitors';
import { seedSkillPacks } from '@/lib/draymond/skill-packs';
import { registerEntities } from '@/lib/draymond/registry';
import { SEED_ENTITIES } from '@/lib/draymond/seed';
import { seedChainTemplates } from '@/lib/draymond/chains-seed';
import { seedMissionChains } from '@/lib/draymond/mission-chains';
import { interconnectSystem } from '@/lib/draymond/systemic';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const startTime = Date.now();

  // ── Run seed ────────────────────────────────────────────────────────
  try {
    // Order matters: registerEntities(SEED_ENTITIES) first, then
    // seedBusinessAutomation() LAST so the business-chain entity configs
    // (http_api URLs the chains actually invoke) win over the registry seed
    // for overlapping slugs (e.g. bet-buddy, bookbridge, omni-research).
    const entityResult = await registerEntities(SEED_ENTITIES);
    const result = await seedBusinessAutomation();
    const monitorResult = await seedAgentMonitors();
    // Flip off monitors for services not checked out / configured on this box,
    // so the fleet doesn't fire "down" forever for agents that can't run here.
    const monitorsDisabled = await disableAbsentServiceMonitors();
    const skillPackResult = await seedSkillPacks();
    const chainTemplatesResult = await seedChainTemplates();
    const missionChainsResult = await seedMissionChains();
    const systemic = await interconnectSystem();
    const durationMs = Date.now() - startTime;

    const allErrors = [
      ...result.errors,
      ...monitorResult.errors,
      ...skillPackResult.errors,
      ...entityResult.errors,
      ...chainTemplatesResult.errors,
      ...missionChainsResult.errors,
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
        disabled: monitorsDisabled,
        names: monitorResult.names,
      },
      skill_packs: {
        seeded: skillPackResult.seeded,
        names: skillPackResult.names,
      },
      registry_entities: {
        registered: entityResult.registered,
        errors: entityResult.errors,
      },
      chain_templates: {
        seeded: chainTemplatesResult.seeded,
        errors: chainTemplatesResult.errors,
      },
      mission_chains: {
        seeded: missionChainsResult.seeded,
        errors: missionChainsResult.errors,
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
