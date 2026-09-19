import { NextRequest, NextResponse } from 'next/server';
import { authorizeMetricsRequest } from '@/lib/draymond/api-auth';
import { selfAnalysisState } from '@/lib/draymond/self-analysis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/ops/self-analysis — latest self-analysis report + finding state.
 * Auth: Bearer METRICS_TOKEN (or CRON_SECRET). Read-only.
 */
export async function GET(request: NextRequest) {
  const authError = authorizeMetricsRequest(request);
  if (authError) return authError;
  try {
    const { state, latest } = await selfAnalysisState();
    return NextResponse.json({ state, latest });
  } catch (err) {
    console.error('[self-analysis] read failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Self-analysis unavailable' }, { status: 500 });
  }
}