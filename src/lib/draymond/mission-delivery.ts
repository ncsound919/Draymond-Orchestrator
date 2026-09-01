/**
 * Mission delivery — dispatch glue. Maps a won opportunity to its service's
 * delivery chain, runs it, and advances the pipeline on a QA-gated result.
 */

import { instantiateChain, executeChain } from "./chains";
import { listOpportunities, addOpportunity } from "./business-pipeline";
import { markDelivered } from "./mission-pipeline";
import { getService, readStrategy, type ServiceId } from "./mission-strategy";

// aetherdesk activates rentals/top-ups via its own Stripe webhook — it is
// deliberately absent so `!chainSlug` routes it to the webhook path below.
const SERVICE_CHAIN: Partial<Record<ServiceId, string>> = {
  maas: "maas-monthly-cycle",
  audit: "audit-delivery",
  research: "research-brief-delivery",
};

export interface DeliveryResult {
  opportunityId: string;
  ok: boolean;
  stage: string;
  invoice?: { id: string; amountCents: number };
  error?: string;
  chainSlug?: string;
  stepStatuses?: Record<string, string>;
}

/**
 * Dispatch delivery for a settled storefront charge. Creates a 'won'
 * opportunity from the Stripe metadata (deduped by stripe charge id so a
 * webhook retry never double-dispatches), then runs the service's delivery
 * chain. Returns the delivery result, or an early result when the service is
 * webhook-driven (Aetherdesk) or already dispatched.
 */
export async function dispatchSettledDelivery(input: {
  stripeChargeId: string;
  serviceId: 'audit' | 'research' | 'maas';
  tierId?: string;
  customerEmail?: string;
}): Promise<DeliveryResult> {
  const { serviceId, stripeChargeId, tierId, customerEmail } = input;

  // Idempotency: find an existing opportunity carrying this charge id.
  const ops = await listOpportunities();
  const existing = ops.find((o) =>
    (o as unknown as Record<string, string>).stripeChargeId === stripeChargeId
  );
  if (existing) {
    return dispatchDelivery(existing.id);
  }

  const strategy = await readStrategy();
  const svc = getService(strategy, serviceId);
  if (!svc) {
    return { opportunityId: "", ok: false, stage: "unknown", error: `service ${serviceId} not in strategy` };
  }
  const tier = svc.tiers.find((t) => t.id === tierId) ?? svc.tiers[0]!;

  const opp = await addOpportunity({
    name: `${svc.name} — ${tier.name}${customerEmail ? ` (${customerEmail})` : ""}`,
    engine: "E2-b2b",
    stage: "won",
    monthlyValue: Math.round(tier.priceCents / 100),
    owner: "mission-engine",
    nextAction: "deliver",
    serviceId,
    tierId: tier.id,
    stripeChargeId,
  });

  return dispatchDelivery(opp.id);
}

export async function dispatchDelivery(opportunityId: string): Promise<DeliveryResult> {
  const ops = await listOpportunities();
  const opp = ops.find((o) => o.id === opportunityId);
  if (!opp) return { opportunityId, ok: false, stage: "unknown", error: "opportunity not found" };
  if (opp.stage !== "won" && opp.stage !== "delivering") {
    return { opportunityId, ok: false, stage: opp.stage, error: `opportunity must be 'won' or 'delivering' to dispatch (was '${opp.stage}')` };
  }

  const serviceId = (opp.serviceId ?? "audit") as ServiceId;
  const strategy = await readStrategy();
  const svc = getService(strategy, serviceId);
  if (!svc) return { opportunityId, ok: false, stage: opp.stage, error: `service ${serviceId} not in strategy` };

  const chainSlug = SERVICE_CHAIN[serviceId];
  if (!chainSlug) {
    return {
      opportunityId, ok: false, stage: opp.stage,
      error: `service ${serviceId} is webhook-driven (Aetherdesk) — not chain-dispatched; attribute settled charges via the Stripe webhook`,
    };
  }
  const input: Record<string, unknown> = {
    ...opp,
    niche: opp.name,
    repoUrl: (opp as unknown as Record<string, string>).repoUrl ?? opp.name,
    topic: opp.name,
    brand_voice: "professional",
  };

  try {
    const instance = await instantiateChain(chainSlug, input, undefined, "mission-engine");
    const ctx = await executeChain(instance.id, "mission-engine");

    const stepStatuses: Record<string, string> = {};
    for (const [key, st] of Object.entries(ctx.steps ?? {})) stepStatuses[key] = st.status;

    const values = Object.values(ctx.steps ?? {});
    const failed = values.filter((s) => s.status === "failed" || s.status === "blocked" || s.status === "retrying");
    if (failed.length > 0) {
      return {
        opportunityId, ok: false, stage: opp.stage, chainSlug, stepStatuses,
        error: `${failed.length} step(s) failed`,
      };
    }

    const delivered = await markDelivered(opportunityId);
    return {
      opportunityId,
      ok: true,
      stage: delivered.opportunity?.stage ?? "invoiced",
      invoice: { id: delivered.invoice.id, amountCents: delivered.invoice.amountCents },
      chainSlug,
      stepStatuses,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      const { recordOutcome } = await import("./self-learning");
      await recordOutcome({
        agentId: "mission-engine",
        kind: "incident",
        summary: `mission dispatch failed: ${chainSlug} for ${opportunityId}`,
        success: false,
        detail: msg.slice(0, 500),
      });
    } catch { /* best-effort */ }
    return { opportunityId, ok: false, stage: opp.stage, chainSlug, error: msg };
  }
}
