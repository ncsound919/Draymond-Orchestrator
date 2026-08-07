/**
 * POST /api/ventures/[id]/review — approve/reject a gated venture.
 * Auth: X-Review-Token header (single-use) OR CRON_SECRET bearer.
 * Body: { approved: boolean }
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';
import { reviewVenture } from '@/lib/draymond/ventures';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const cronAuthorized = authorizeRequest(request) === null;
  const token = request.headers.get('x-review-token') ?? '';
  const bodyResult = await parseJsonBody<{ approved?: unknown }>(request);
  if (bodyResult.error) return bodyResult.error;
  if (typeof bodyResult.data.approved !== 'boolean') {
    return NextResponse.json({ error: 'approved (boolean) is required' }, { status: 400 });
  }

  try {
    const record = await reviewVenture(id, token, bodyResult.data.approved, cronAuthorized);
    return NextResponse.json({ ok: true, venture: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to review venture';
    const status =
      message === 'Unauthorized' ? 401 :
      message === 'Review token expired' ? 410 :
      message === 'Venture not found' ? 404 :
      message.includes('not pending review') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
