/**
 * GET/PATCH /api/ops/controls
 *
 * Read or persist the operator's fleet controls (knobs/sliders) backed by
 * `.draymond/controls.json`. The stored value wins over env, which wins over
 * the default. Auth: CRON_SECRET Bearer token via authorizeRequest.
 *
 * GET  → { controls, effective, source } where `effective` is the fully
 *        resolved object and `source` is 'stored' | 'env' | 'default'.
 * PATCH → body: { repair?, discovery?, fleet? } (partial). Values are clamped
 *        to bounds and persisted; returns the saved object + updatedAt.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';
import {
  clampControls,
  isControlsLike,
  readControls,
  resolveBudget,
  resolveCooldownMs,
  writeControls,
  type FleetControls,
} from '@/lib/command-center/controls';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const controls = await readControls();
    const { controls: effective, source } = resolveEffective(controls);
    return NextResponse.json({ controls, effective, source });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to read controls' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const bodyResult = await parseJsonBody<Record<string, unknown>>(request);
  if (bodyResult.error) return bodyResult.error;

  const patch = bodyResult.data;
  if (!isControlsLike(patch)) {
    return NextResponse.json(
      { error: 'expected a partial controls object ({ repair?, discovery?, fleet? })' },
      { status: 400 },
    );
  }

  try {
    const current = await readControls();
    const merged = clampControls({
      repair: { ...current.repair, ...(patch.repair ?? {}) },
      discovery: { ...current.discovery, ...(patch.discovery ?? {}) },
      fleet: { ...current.fleet, ...(patch.fleet ?? {}) },
    });
    const saved = await writeControls(merged);
    return NextResponse.json({ ok: true, controls: saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed to persist controls' },
      { status: 500 },
    );
  }
}

/** Resolve the effective object + which layer it came from. */
function resolveEffective(controls: FleetControls): {
  controls: FleetControls;
  effective: FleetControls;
  source: 'stored' | 'env' | 'default';
} {
  const dflt = clampControls(undefined);
  const envBudget = process.env.DRAYMOND_FLEET_DAILY_BUDGET;
  const envCooldown = process.env.DRAYMOND_REPAIR_COOLDOWN_MS;
  const hasStored =
    controls.updatedAt != null ||
    controls.repair.cooldownMinutes !== dflt.repair.cooldownMinutes ||
    controls.fleet.dailyBudgetTokens !== dflt.fleet.dailyBudgetTokens;

  const effective: FleetControls = clampControls({
    ...controls,
    repair: {
      ...controls.repair,
      cooldownMinutes: Math.round(
        resolveCooldownMs(controls.repair.cooldownMinutes, envCooldown) / 60_000,
      ),
    },
    fleet: {
      ...controls.fleet,
      dailyBudgetTokens: resolveBudget(controls.fleet.dailyBudgetTokens, envBudget),
    },
  });

  const source = hasStored
    ? 'stored'
    : envBudget || envCooldown
      ? 'env'
      : 'default';
  return { controls, effective, source };
}
