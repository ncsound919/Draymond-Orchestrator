import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { refineHypothesis } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

/** POST /api/math/hypothesis/refine — refine or confirm a tested conjecture. */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ conjecture?: string; testResult?: string; verdict?: string }>(request);
  if (parsed.error) return parsed.error;
  const { conjecture, testResult, verdict } = parsed.data;

  if (!conjecture || !testResult || !verdict) {
    return NextResponse.json(
      { error: 'conjecture, testResult, and verdict are required' },
      { status: 400 },
    );
  }
  if (!['supported', 'refuted', 'inconclusive'].includes(verdict)) {
    return NextResponse.json(
      { error: 'verdict must be one of: supported, refuted, inconclusive' },
      { status: 400 },
    );
  }
  try {
    const result = await refineHypothesis(conjecture, testResult, verdict);
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
