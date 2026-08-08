import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { searchUniprot } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

/** POST /api/math/bio/uniprot — live UniProt protein search. */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ query?: string; size?: number }>(request);
  if (parsed.error) return parsed.error;
  const { query, size } = parsed.data;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 });
  }
  const count = typeof size === 'number' ? Math.max(1, Math.min(10, size)) : 5;

  try {
    const result = await searchUniprot(query.trim(), count);
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
