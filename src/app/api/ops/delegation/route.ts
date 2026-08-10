import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import {
  delegationSnapshot,
  resetDelegation,
  fleetDailyBudget,
  phaseBudget,
} from '@/lib/draymond/delegation';
import { fleetBudgetRemaining } from '@/lib/draymond/workflow-budget';

export const dynamic = 'force-dynamic';

/** GET /api/ops/delegation — the delegation plan + live consumption state */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const snapshot = delegationSnapshot();
  return NextResponse.json({
    ...snapshot,
    fleet: {
      dailyBudget: fleetDailyBudget(),
      remaining: fleetBudgetRemaining(),
    },
    phaseBudgets: {
      morning: phaseBudget('morning'),
      midday: phaseBudget('midday'),
      evening: phaseBudget('evening'),
      night: phaseBudget('night'),
    },
  });
}

/** POST /api/ops/delegation — { reset: true } clears consumption tracking */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.reset === true) {
    resetDelegation();
    return NextResponse.json({ reset: true });
  }
  return NextResponse.json({ error: 'send { reset: true }' }, { status: 400 });
}
