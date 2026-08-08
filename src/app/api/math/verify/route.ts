import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { verifyDerivation } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

/** POST /api/math/verify — extract derivation steps + generate SymPy check code. */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ expression?: string; mode?: string; domain?: string }>(request);
  if (parsed.error) return parsed.error;
  const { expression, mode, domain } = parsed.data;

  if (!expression || typeof expression !== 'string' || expression.trim().length === 0) {
    return NextResponse.json({ error: 'expression is required' }, { status: 400 });
  }
  try {
    const result = await verifyDerivation(expression.trim(), mode, domain);
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
