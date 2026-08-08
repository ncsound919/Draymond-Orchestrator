import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { getGenes } from '@/lib/mathx/services';
import { isValidId } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/** GET /api/math/literature/gene/[query] — NCBI Gene lookup. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ query: string }> },
) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const { query } = await params;
  if (!query || !isValidId(query)) {
    return NextResponse.json({ error: 'Invalid gene query' }, { status: 400 });
  }
  try {
    const result = await getGenes(query);
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
