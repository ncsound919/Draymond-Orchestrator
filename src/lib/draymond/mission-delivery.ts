/**
 * Mission delivery — dispatch glue. Maps a won opportunity to its service's
 * delivery chain, runs it, and advances the pipeline on a QA-gated result.
 */

import { instantiateChain, executeChain } from "./chains";
import { listOpportunities } from "./business-pipeline";
import { markDelivered } from "./mission-pipeline";
import { getService, readStrategy, type ServiceId } from "./mission-strategy";

const SERVICE_CHAIN: Record<ServiceId, string> = {
  aetherdesk: "audit-delivery", // placeholder: aetherdesk uses its own platform webhook
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
