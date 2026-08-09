import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { dispatchDelivery } from '@/lib/draymond/mission-delivery';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const opportunityId = typeof body.opportunityId === 'string' ? body.opportunityId : '';
  if (!opportunityId) {
    return NextResponse.json({ error: 'opportunityId is required' }, { status: 400 });
  }

  const result = await dispatchDelivery(opportunityId);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
