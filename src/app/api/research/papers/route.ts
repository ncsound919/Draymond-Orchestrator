import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';
import { readJsonState } from '@/lib/draymond/cognition';

export const dynamic = 'force-dynamic';

/**
 * Research paper registry — read-only endpoint for the Overlay Global Lens
 * outlet (and any fleet consumer). Mirrors `.draymond/research-papers.json`.
 *
 * GET /api/research/papers
 *   → { ok: true, papers: { goalKey: Paper[] } }
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const state = await readJsonState<{ papers?: Record<string, unknown[]> }>('research-papers', {
      papers: {},
    });
    return NextResponse.json({ ok: true, papers: state?.papers ?? {} });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
