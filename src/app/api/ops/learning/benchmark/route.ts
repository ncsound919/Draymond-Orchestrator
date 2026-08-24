import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { saveBenchmarkWeights, type DriftDetectionMetrics, type SelfTunedFacetWeights } from '@/lib/draymond/learning-store';

export const dynamic = 'force-dynamic';

/** POST /api/ops/learning/benchmark — publish Benchmark Olympics facet weights + drift */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as {
    benchmarkWeights?: SelfTunedFacetWeights;
    driftMetrics?: DriftDetectionMetrics;
  };
  if (!body.benchmarkWeights || typeof body.benchmarkWeights.speedAndLatency !== 'number') {
    return NextResponse.json({ error: 'benchmarkWeights.speedAndLatency required' }, { status: 400 });
  }
  await saveBenchmarkWeights(body.benchmarkWeights, body.driftMetrics ?? null);
  return NextResponse.json({ ok: true });
}
