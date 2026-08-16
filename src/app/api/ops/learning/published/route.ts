import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { savePublicationEvent } from '@/lib/draymond/learning-store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/learning/published — record a publish-success event.
 * Low-grade publications (score < 500) are recorded as 'low_grade_published'
 * so the grader learns from over-promising.
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as {
    goalId?: string; discoveryId?: string; source?: string; gradeScore?: number;
  };
  if (!body.goalId) {
    return NextResponse.json({ error: 'goalId required' }, { status: 400 });
  }
  const gradeScore = body.gradeScore === undefined ? 0 : Number(body.gradeScore);
  if (!Number.isFinite(gradeScore)) {
    return NextResponse.json({ error: 'gradeScore must be a finite number' }, { status: 400 });
  }
  const outcome = gradeScore >= 500 ? 'success' : 'low_grade_published';
  await savePublicationEvent({
    id: `pe_${Date.now()}`,
    goalId: body.goalId,
    discoveryId: body.discoveryId ?? body.goalId,
    source: body.source ?? 'curemind',
    publishedAt: new Date().toISOString(),
    gradeScore,
    outcome,
  });
  return NextResponse.json({ ok: true, outcome });
}
