import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';

/**
 * POST /api/business/stripe-webhook
 * Stripe webhook endpoint — records settled charges into the treasury in
 * real time (in addition to the daily `treasury_pulse` pull).
 *
 * Signature verification (no Stripe SDK dependency): Stripe signs the raw
 * request body with HMAC-SHA256 over `t=<timestamp>.<body>` using the webhook
 * secret. We verify the `stripe-signature` header the same way.
 *
 * Auth: the webhook must be configured with STRIPE_WEBHOOK_SECRET. When the
 * secret is unset the route rejects with 503 — it never accepts unsigned
 * payment events.
 */

function readRawBody(req: Request): Promise<Buffer> {
  return req.arrayBuffer().then((ab) => Buffer.from(ab));
}

/** Timing-safe comparison of two hex signatures. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

/**
 * Verify a Stripe webhook signature over the raw body.
 * Returns true when the signature is valid (or no secret is configured —
 * caller decides how to handle that).
 */
export function verifyStripeSignature(rawBody: Buffer, sigHeader: string, secret: string): boolean {
  if (!secret || !sigHeader) return false;
  // Stripe sends: t=<timestamp>,v1=<hex>,v0=<legacy-hex>
  const parts = new Map(sigHeader.split(',').map((p) => {
    const idx = p.indexOf('=');
    return idx > 0 ? [p.slice(0, idx), p.slice(idx + 1)] : [p, ''];
  }));
  const timestamp = parts.get('t');
  const v1 = parts.get('v1');
  if (!timestamp || !v1) return false;

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  return safeEqual(expected, v1);
}

interface StripeEvent {
  id: string;
  type: string;
  data?: {
    object?: {
      id?: string;
      amount?: number;
      currency?: string;
      status?: string;
      refunded?: boolean;
      created?: number;
      metadata?: Record<string, string>;
    };
  };
}

/**
 * Record a settled charge event into the treasury ledger. Re-uses the same
 * ledger/`revenueCents` state as `treasury_pulse` so pull + push stay consistent.
 */
export async function recordChargeFromWebhook(event: StripeEvent): Promise<{ recorded: boolean; revenueUsd: number }> {
  const { readState, writeState, recomputeRevenueFromLedger } = await import('@/lib/draymond/treasury-state');
  const state = await readState();
  const charge = event.data?.object;
  if (!charge?.id || !charge.amount) return { recorded: false, revenueUsd: Math.round(state.revenueCents / 100) };

  const isRefunded = charge.refunded === true;
  const settledStatus = isRefunded ? 'refunded' : (charge.status ?? 'unknown');
  const metadata = charge.metadata;
  const value = (metadata?.platform ?? metadata?.product ?? '').toLowerCase();
  const platform = value.includes('health') ? 'health'
    : value.includes('wealth') ? 'wealth'
    : value.includes('justice') ? 'justice'
    : 'cross-platform';

  state.charges[charge.id] = {
    id: charge.id,
    amountCents: charge.amount,
    currency: charge.currency ?? 'usd',
    platform,
    status: settledStatus,
    createdAt: new Date((charge.created ?? Date.now() / 1000) * 1000).toISOString(),
  };
  state.revenueCents = recomputeRevenueFromLedger(state);
  state.updatedAt = new Date().toISOString();
  await writeState(state);

  // Mission attribution: settled charges carrying metadata.service are
  // attributed to that service line's paid revenue (Aetherdesk rentals/top-ups
  // and mission prices all set metadata.service). Never fabricates — only runs
  // when the charge actually settled.
  if (settledStatus === 'succeeded') {
    try {
      const serviceValue = (metadata?.service ?? '').toLowerCase();
      if (serviceValue === 'aetherdesk' || serviceValue === 'maas' || serviceValue === 'audit' || serviceValue === 'research') {
        const { attributeSettledCharge } = await import('@/lib/draymond/mission-pipeline');
        await attributeSettledCharge({
          stripeChargeId: charge.id,
          amountCents: charge.amount,
          serviceId: serviceValue as 'aetherdesk' | 'maas' | 'audit' | 'research',
          opportunityId: metadata?.opportunityId,
        });
      }
    } catch {
      /* mission attribution best-effort — treasury already recorded */
    }
  }

  return { recorded: true, revenueUsd: Math.round(state.revenueCents / 100) };
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, { status: 503 });
  }

  const raw = await readRawBody(request).catch(() => null);
  if (!raw) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const sig = request.headers.get('stripe-signature');
  if (typeof sig !== 'string' || !verifyStripeSignature(raw, sig, webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(raw.toString('utf8')) as StripeEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (event.type === 'charge.succeeded' || event.type === 'charge.refunded') {
    const { recorded, revenueUsd } = await recordChargeFromWebhook(event);
    if (recorded) {
      try {
        const { recordOutcome } = await import('@/lib/draymond/self-learning');
        await recordOutcome({
          agentId: 'overlay-treasurer',
          kind: 'manual',
          summary: `stripe webhook ${event.type}`,
          success: true,
          detail: `settled revenue now $${revenueUsd} (${event.data?.object?.id ?? 'unknown charge'})`,
        });
      } catch {
        /* learning store best-effort */
      }
    }
  }

  return NextResponse.json({ received: true });
}
