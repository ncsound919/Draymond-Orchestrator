import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { dayPlan, runPhase, DAY_FLOW, dayPhaseBudget, type DayPhase } from '@/lib/draymond/day-orchestrator';

export const dynamic = 'force-dynamic';

const PHASES: DayPhase[] = ['morning', 'midday', 'evening', 'night'];

/** GET /api/ops/day — today's orchestration plan + what's due next */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const plan = dayPlan();
  const phaseBudgets = Object.fromEntries(PHASES.map((p) => [p, dayPhaseBudget(p)]));
  return NextResponse.json({ ...plan, totalSteps: DAY_FLOW.length, phaseBudgets });
}

/** POST /api/ops/day?phase=morning|midday|evening|night — run a phase group now,
 *  bounded by the delegation plan's token budget for that phase. */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const phase = new URL(request.url).searchParams.get('phase') as DayPhase | null;
  if (!phase || !PHASES.includes(phase)) {
    return NextResponse.json({ error: `phase must be one of: ${PHASES.join(', ')}` }, { status: 400 });
  }
  const result = await runPhase(phase, dayPhaseBudget(phase));
  return NextResponse.json(result, { status: result.errors.length ? 202 : 200 });
}
