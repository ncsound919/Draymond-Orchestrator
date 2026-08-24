import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';
import { listGaps } from '@/lib/science/researchEscalation';

export const dynamic = 'force-dynamic';

/**
 * List escalated research gaps (newest first).
 *   GET /api/v1/science/gaps?status=open&kind=anomaly&limit=50
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const params = new URL(request.url).searchParams;
    const gaps = await listGaps({
      status: params.get('status') ?? undefined,
      kind: params.get('kind') ?? undefined,
      limit: params.has('limit') ? Number(params.get('limit')) : undefined,
    });
    return NextResponse.json({ ok: true, gaps });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 400 });
  }
}
