'use server';

import { requireDraymondActionAuth } from '@/lib/draymond/auth';
import { createCheckoutSession } from '@/lib/draymond/mission-checkout';
import type { ServiceId } from '@/lib/draymond/mission-strategy';

export interface CheckoutActionResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * Server-side checkout proxy for the Mission Control page.
 *
 * The client never sees STRIPE_SECRET_KEY: buttons call this action, which
 * creates the Stripe Checkout session on the server and returns only the
 * payment URL to redirect to.
 */
export async function createMissionCheckout(input: {
  serviceId: ServiceId;
  tierId: string;
  opportunityId?: string;
}): Promise<CheckoutActionResult> {
  try {
    await requireDraymondActionAuth();
  } catch {
    return { ok: false, error: 'Not authorized' };
  }

  try {
    const result = await createCheckoutSession(input);
    return { ok: true, url: result.url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
