import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { runHypothesis } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

/** POST /api/math/hypothesis/run — generate a conjecture + falsifiable test. */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ statement?: string; mode?: string; context?: string }>(request);
  if (parsed.error) return parsed.error;
  const { statement, mode, context } = parsed.data;

  if (!statement || typeof statement !== 'string' || statement.trim().length === 0) {
    return NextResponse.json({ error: 'statement is required' }, { status: 400 });
  }
  try {
    const result = await runHypothesis(statement.trim(), mode, context);
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
