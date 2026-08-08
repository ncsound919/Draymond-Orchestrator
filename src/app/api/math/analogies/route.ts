import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { runAnalogies } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

/** POST /api/math/analogies — cross-domain structural analogies for a concept. */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ concept?: string; domain?: string; maxAnalogies?: number }>(request);
  if (parsed.error) return parsed.error;
  const { concept, domain, maxAnalogies } = parsed.data;

  if (!concept || typeof concept !== 'string' || concept.trim().length === 0) {
    return NextResponse.json({ error: 'concept is required' }, { status: 400 });
  }
  const count = typeof maxAnalogies === 'number' ? Math.max(2, Math.min(6, Math.floor(maxAnalogies))) : 4;
  try {
    const result = await runAnalogies(concept.trim(), domain, count);
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
