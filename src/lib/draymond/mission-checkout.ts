/**
 * Mission checkout — creates a Stripe Checkout session for a service tier.
 *
 * Uses the Stripe REST API directly (no SDK dependency, same as treasury.ts).
 * Sets metadata.service + metadata.tier + optional metadata.opportunityId so
 * the webhook attributes settled revenue to the right service line and advances
 * the linked opportunity to 'paid'.
 */

import { readStrategy, getService, type ServiceId } from "./mission-strategy";

export interface CheckoutSessionInput {
  serviceId: ServiceId;
  tierId: string;
  opportunityId?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutSessionResult {
  url: string;
  sessionId: string;
  serviceId: ServiceId;
  tierId: string;
  mode: "payment" | "subscription";
}

export async function createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY not configured");

  const strategy = await readStrategy();
  const svc = getService(strategy, input.serviceId);
  const tier = svc?.tiers.find((t) => t.id === input.tierId);
  if (!svc || !tier) throw new Error(`unknown service/tier: ${input.serviceId}/${input.tierId}`);

  const appUrl = process.env.DRAYMOND_PUBLIC_URL || "http://localhost:3444";
  const success = input.successUrl ?? `${appUrl}/mission?checkout=success`;
  const cancel = input.cancelUrl ?? `${appUrl}/mission?checkout=canceled`;
  const mode: "payment" | "subscription" = svc.billing === "recurring_monthly" ? "subscription" : "payment";

  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("line_items[0][price]", tier.stripePriceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", success);
  params.set("cancel_url", cancel);
  params.set("metadata[service]", svc.id);
  params.set("metadata[tier]", tier.id);
  if (input.opportunityId) params.set("metadata[opportunityId]", input.opportunityId);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });

  const data = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) {
    throw new Error(data.error?.message ?? `stripe checkout: HTTP ${res.status}`);
  }

  return { url: data.url, sessionId: data.id ?? "", serviceId: svc.id, tierId: tier.id, mode };
}
