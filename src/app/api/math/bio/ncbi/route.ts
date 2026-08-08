import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { searchNcbi } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

const DBS = ['nucleotide', 'protein', 'gene', 'pubmed'] as const;

/** POST /api/math/bio/ncbi — live NCBI E-utilities search. */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ query?: string; db?: string; retmax?: number }>(request);
  if (parsed.error) return parsed.error;
  const { query, db, retmax } = parsed.data;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 });
  }
  const pickedDb = DBS.includes(db as (typeof DBS)[number]) ? (db as (typeof DBS)[number]) : 'protein';
  const count = typeof retmax === 'number' ? Math.max(1, Math.min(20, retmax)) : 5;

  try {
    const result = await searchNcbi(query.trim(), pickedDb, count);
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
