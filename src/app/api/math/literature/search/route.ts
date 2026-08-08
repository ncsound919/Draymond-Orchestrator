import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { searchLiterature } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

const SOURCES = ['pubmed', 'arxiv'] as const;

/** POST /api/math/literature/search — PubMed + arXiv paper search (RAG feed). */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ query?: string; sources?: string[]; maxPerSource?: number }>(request);
  if (parsed.error) return parsed.error;
  const { query, sources, maxPerSource } = parsed.data;

  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return NextResponse.json({ error: 'query is required (min 2 chars)' }, { status: 400 });
  }
  const picked = (Array.isArray(sources) ? sources : ['pubmed', 'arxiv']).filter(
    (s): s is 'pubmed' | 'arxiv' => SOURCES.includes(s as 'pubmed' | 'arxiv'),
  );
  const max = typeof maxPerSource === 'number' ? Math.max(1, Math.min(10, maxPerSource)) : 4;

  try {
    const result = await searchLiterature(query.trim(), picked.length ? picked : [...SOURCES], max);
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
