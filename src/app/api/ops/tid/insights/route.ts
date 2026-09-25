import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { TidEngine } from '@/lib/draymond/tid-engine';
import type { TidInsightStatus, TidInsightType } from '@/lib/draymond/tid-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/tid/insights — detected TID insights.
 *
 * Read-only surface over `tid_insights` so fleet peers (e.g. Recourse) can
 * consume Draymond's detected patterns. Query:
 *   status, type, minConfidence, limit (default 50, max 500).
 * Auth: Bearer CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const sp = request.nextUrl.searchParams;
    const limit = Math.max(1, Math.min(500, Number(sp.get('limit')) || 50));
    const minConfidenceRaw = sp.get('minConfidence');
    const minConfidence = minConfidenceRaw === null ? undefined : Number(minConfidenceRaw);
    const insights = await TidEngine.listInsights({
      status: (sp.get('status') as TidInsightStatus) || undefined,
      type: (sp.get('type') as TidInsightType) || undefined,
      ...(typeof minConfidence === 'number' && Number.isFinite(minConfidence) ? { minConfidence } : {}),
      limit,
    });
    return NextResponse.json({ ok: true, count: insights.length, insights });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
