import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/brain/fallback — live fallback-coverage report (the brain is
 * Draymond's fallback: covered ÷ known LLM functions + degraded flag).
 *
 * POST /api/ops/brain/fallback — toggle degraded mode.
 *   Body: { degraded: boolean }
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const { getFallbackCoverage } = await import('@/lib/draymond/fallbacks');
  return NextResponse.json({ coverage: getFallbackCoverage() });
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    degraded?: boolean;
  }>(request);
  if (parseError) return parseError;

  if (typeof body?.degraded !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'degraded (boolean) is required' },
      { status: 400 },
    );
  }

  const { setDegraded, getFallbackCoverage } = await import('@/lib/draymond/fallbacks');
  setDegraded(body.degraded);
  return NextResponse.json({ ok: true, degraded: body.degraded, coverage: getFallbackCoverage() });
}
