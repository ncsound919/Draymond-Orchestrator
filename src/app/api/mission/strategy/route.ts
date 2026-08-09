import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { readStrategy, totalMonthlyTarget, unitEconomics } from '@/lib/draymond/mission-strategy';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const strategy = await readStrategy();
  return NextResponse.json({
    ...strategy,
    totalMonthlyTarget: totalMonthlyTarget(strategy),
    unitEconomics: strategy.services.map((s) => ({ service: s.id, ...unitEconomics(s) })),
  });
}
