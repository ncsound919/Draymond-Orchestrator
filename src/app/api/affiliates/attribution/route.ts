import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { recordAttribution } from '@/lib/draymond/affiliates';

export const dynamic = 'force-dynamic';

/**
 * POST /api/affiliates/attribution
 * Record a click → signup → revenue event and accrue commissions.
 *
 * Body: { kind: 'signup' | 'revenue', code, customerId, serviceId?, voiceTier?, amountUsd? }
 * Only SETTLED revenue (amountUsd) accrues commissions — signups accrue nothing.
 * This is the endpoint Aetherdesk's Stripe webhook calls on a settled charge.
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => null)) as {
    kind?: string;
    code?: string;
    customerId?: string;
    serviceId?: string;
    voiceTier?: string;
    amountUsd?: number;
  } | null;

  if (body?.kind !== 'signup' && body?.kind !== 'revenue') {
    return NextResponse.json({ error: "kind must be 'signup' or 'revenue'" }, { status: 400 });
  }
  if (!body.code || !body.customerId) {
    return NextResponse.json({ error: 'code and customerId are required' }, { status: 400 });
  }
  if (body.kind === 'revenue' && typeof body.amountUsd !== 'number') {
    return NextResponse.json({ error: 'amountUsd is required for revenue events' }, { status: 400 });
  }

  try {
    const result = await recordAttribution(body.kind as 'signup' | 'revenue', {
      code: body.code,
      customerId: body.customerId,
      serviceId: body.serviceId,
      voiceTier: body.voiceTier,
      amountUsd: body.amountUsd,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
