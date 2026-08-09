import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { pipelineSummary } from '@/lib/draymond/business-pipeline';

export const dynamic = 'force-dynamic';

/**
 * GET /api/business/pipeline
 * Mission-control summary: pipeline by stage/engine, won monthly value, revenue
 * to date vs the $33k/mo target, and required daily run-rate.
 *
 * `revenueToDate` defaults to the treasury's settled cash (real money) unless
 * explicitly overridden via the query param.
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { settledRevenueUsd } = await import('@/lib/draymond/treasury-state');
  const param = new URL(request.url).searchParams.get('revenueToDate');
  const revenueToDate = param === null || param === ''
    ? await settledRevenueUsd()
    : Number(param);
  const safeRevenue = Number.isFinite(revenueToDate) ? revenueToDate : 0;

  return NextResponse.json(await pipelineSummary(safeRevenue));
}
