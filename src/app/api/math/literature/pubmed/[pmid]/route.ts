import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { getPubmedPaper } from '@/lib/mathx/services';
import { isValidId } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/** GET /api/math/literature/pubmed/[pmid] — fetch one paper by PMID. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pmid: string }> },
) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const { pmid } = await params;
  if (!pmid || !isValidId(pmid)) {
    return NextResponse.json({ error: 'Invalid pmid' }, { status: 400 });
  }
  try {
    const result = await getPubmedPaper(pmid);
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
