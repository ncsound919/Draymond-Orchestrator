import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { createCheckoutSession } from '@/lib/draymond/mission-checkout';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const serviceId = typeof body.serviceId === 'string' ? body.serviceId : '';
  const tierId = typeof body.tierId === 'string' ? body.tierId : '';
  const opportunityId = typeof body.opportunityId === 'string' ? body.opportunityId : undefined;
  const successUrl = typeof body.successUrl === 'string' ? body.successUrl : undefined;
  const cancelUrl = typeof body.cancelUrl === 'string' ? body.cancelUrl : undefined;

  if (!serviceId || !tierId) {
    return NextResponse.json({ error: 'serviceId and tierId are required' }, { status: 400 });
  }

  const allowed: Array<'aetherdesk' | 'maas' | 'audit' | 'research'> = ['aetherdesk', 'maas', 'audit', 'research'];
  if (!allowed.includes(serviceId as never)) {
    return NextResponse.json({ error: `unknown serviceId: ${serviceId}` }, { status: 400 });
  }

  try {
    const result = await createCheckoutSession({
      serviceId: serviceId as never,
      tierId,
      opportunityId,
      successUrl,
      cancelUrl,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
