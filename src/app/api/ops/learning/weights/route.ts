import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { saveGradeWeights } from '@/lib/draymond/learning-store';

export const dynamic = 'force-dynamic';

/** POST /api/ops/learning/weights — publish research-grade adapted weights */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as { weights?: Record<string, number> };
  const weights = body.weights;
  if (!weights || typeof weights.novelty !== 'number') {
    return NextResponse.json({ error: 'weights with a numeric novelty field are required' }, { status: 400 });
  }
  await saveGradeWeights({
    novelty: weights.novelty, testability: weights.testability ?? 0,
    evidence: weights.evidence ?? 0, impact: weights.impact ?? 0,
    maturity: weights.maturity ?? 0, crossDomain: weights.crossDomain ?? 0,
  });
  return NextResponse.json({ ok: true });
}
