import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { planMath } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

/** POST /api/math/plan — classify a query into an execution plan. */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ query?: string; mode?: string; domain?: string; hasFiles?: boolean }>(request);
  if (parsed.error) return parsed.error;
  const { query, mode, domain, hasFiles } = parsed.data;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 });
  }
  try {
    const plan = await planMath(query.trim(), mode, domain, hasFiles);
    return NextResponse.json({ plan });
  } catch (err) {
    return mathErrorResponse(err);
  }
}
