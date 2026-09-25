import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/science/insights — latest persisted cross-domain InsightReports.
 *
 * Read surface over the `science_insights` trends store (`listInsights`) so
 * fleet peers (e.g. Recourse) can read back the cross-domain reports written
 * through `POST /api/v1/science/insights/persist`. Query: source, limit.
 * Auth: Bearer CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const { listInsights } = await import('@/lib/science/trendsFeed');
    const sp = request.nextUrl.searchParams;
    const source = sp.get('source') || undefined;
    const limit = Math.max(1, Math.min(500, Number(sp.get('limit')) || 50));
    const insights = await listInsights({ ...(source ? { source } : {}), limit });
    return NextResponse.json({ ok: true, count: insights.length, insights });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
