import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { escalateGaps } from '@/lib/science/researchEscalation';

export const dynamic = 'force-dynamic';

/**
 * Manual/backfill escalation of research-gap records.
 *   POST /api/v1/science/gaps/escalate
 *     { gaps: [ {gap_id, kind, title, detail?, source_ref?, evidence_tier?,
 *               severity?, detected_at?} ], domain?: string }
 * Idempotent on gap_id — re-posted gaps update their row instead of duplicating.
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    gaps?: unknown[];
    domain?: string;
  }>(request);
  if (parseError) return parseError;

  if (!Array.isArray(body?.gaps) || body.gaps.length === 0) {
    return NextResponse.json({ ok: false, error: 'gaps array required' }, { status: 400 });
  }

  try {
    const result = await escalateGaps(body.gaps, { domain: body.domain });
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 400 });
  }
}
