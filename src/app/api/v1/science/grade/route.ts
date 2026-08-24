import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/v1/science/grade — top frontier/promising discoveries.
 * POST /api/v1/science/grade — run a research-grade pass over all goals and
 *   return the refreshed grades + top discoveries.
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const { discoveries } = await import('@/lib/science/research-grade');
    return NextResponse.json({ ok: true, discoveries: await discoveries() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const { gradeResearch, discoveries } = await import('@/lib/science/research-grade');
    const result = await gradeResearch();
    return NextResponse.json({
      ok: true,
      graded: result.grades.length,
      insights: result.insights,
      discoveries: await discoveries(),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'grade failed' }, { status: 500 });
  }
}
