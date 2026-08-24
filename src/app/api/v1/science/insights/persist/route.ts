import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { persistInsightReport } from '@/lib/science/trendsFeed';

export const dynamic = 'force-dynamic';

/**
 * Manual/backfill persistence of a bbtech InsightReport into the trends store.
 *   POST /api/v1/science/insights/persist
 *     { report: {...InsightReport}, source?: string, session_id?: string,
 *       domain?: string, evidence_tier?: 'E1'|'E2'|'E3'|'E4', generated_at?: string }
 * Idempotent on (source, session_id, generated_at) — re-posting the same
 * report updates the row and returns duplicate:true.
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    report?: Record<string, unknown>;
    source?: string;
    session_id?: string;
    domain?: string;
    evidence_tier?: string;
    generated_at?: string;
  }>(request);
  if (parseError) return parseError;

  if (!body?.report || typeof body.report !== 'object' || Array.isArray(body.report)) {
    return NextResponse.json({ ok: false, error: 'report required' }, { status: 400 });
  }

  try {
    const result = await persistInsightReport(body.report, {
      source: body.source,
      sessionId: body.session_id,
      domain: body.domain,
      evidenceTier: body.evidence_tier,
      generatedAt: body.generated_at,
    });
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 400 });
  }
}
