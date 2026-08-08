import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { runBrainDecision, agendaSnapshot } from '@/lib/draymond/brain-decision';

export const dynamic = 'force-dynamic';

/** GET /api/ops/brain — current agenda snapshot + brain status */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const { getBrainStatus } = await import('@/lib/draymond/brain-client');
    const [agenda, brain] = await Promise.all([agendaSnapshot(), getBrainStatus()]);
    return NextResponse.json({ agenda, brain });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

/** POST /api/ops/brain — run a decision cycle now */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const decision = await runBrainDecision();
    return NextResponse.json(decision, { status: decision.actions.length > 0 ? 200 : 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
