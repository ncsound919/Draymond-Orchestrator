import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { pipelineSummary } from '@/lib/draymond/business-pipeline';

export const dynamic = 'force-dynamic';

/**
 * GET /api/business/pipeline
 * Mission-control summary: pipeline by stage/engine, won monthly value, revenue
 * to date vs the $33k/mo target, and required daily run-rate.
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const revenueParam = Number(new URL(request.url).searchParams.get('revenueToDate') ?? 0);
  const revenueToDate = Number.isFinite(revenueParam) ? revenueParam : 0;

  return NextResponse.json(await pipelineSummary(revenueToDate));
}
