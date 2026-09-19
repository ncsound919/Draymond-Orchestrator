import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { orgSnapshot } from '@/lib/draymond/corporate';
import { fleetDailyBudget, sectorConsumed, sectorRemaining, canDelegateSector } from '@/lib/draymond/delegation';
import { sectorProductivity, readSectorProductivity } from '@/lib/draymond/sector-productivity';

export const dynamic = 'force-dynamic';

/** GET /api/ops/org — the corporate org chart + per-sector budget utilization + productivity */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const budget = fleetDailyBudget();
  const org = orgSnapshot(budget);
  const productivity = sectorProductivity();

  const sectors = org.sectors.map((s) => {
    const consumed = sectorConsumed(s.id);
    const remaining = sectorRemaining(s.id);
    const gate = canDelegateSector(s.id, new Date());
    return {
      ...s,
      consumed,
      remaining,
      utilizationPct: s.dailyCap > 0 ? Math.round((consumed / s.dailyCap) * 1000) / 10 : 0,
      active: gate.ok,
      reason: gate.ok ? undefined : gate.reason,
      productivity: productivity.sectors.find((p) => p.sector === s.id) ?? null,
    };
  });

  return NextResponse.json({
    offices: org.offices,
    fleetBudget: budget,
    sectors,
    productivity: {
      generatedAt: productivity.generatedAt,
      persistedAt: readSectorProductivity()?.updatedAt ?? null,
    },
  });
}

/** POST /api/ops/org — { persist: true } writes the productivity snapshot to disk */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.persist === true) {
    const { writeSectorProductivity } = await import('@/lib/draymond/sector-productivity');
    writeSectorProductivity();
    return NextResponse.json({ persisted: true, file: 'sector-productivity.json' });
  }
  return NextResponse.json({ error: 'send { persist: true }' }, { status: 400 });
}