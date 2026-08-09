/**
 * Mission pipeline — invoice ledger + stage automaton for the 4 service lines.
 *
 * Advances opportunities won → delivering → invoiced → paid from delivery
 * chain outcomes and settled Stripe charges. Invoices live in
 * .draymond/invoices.json (JSON-state pattern).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { readStrategy, getService, serviceTargets, totalMonthlyTarget, type ServiceId } from "./mission-strategy";
import { listOpportunities, updateOpportunityStage, type Opportunity } from "./business-pipeline";

export type InvoiceStatus = "open" | "paid";

const DEFAULT_SERVICE: ServiceId = "audit";
const WON_STAGES = new Set<string>(["won", "delivering", "invoiced", "paid"]);

function isServiceId(v: unknown): v is ServiceId {
  return v === "aetherdesk" || v === "maas" || v === "audit" || v === "research";
}

export interface Invoice {
  id: string;
  opportunityId: string;
  serviceId: ServiceId;
  tierId: string;
  amountCents: number;
  status: InvoiceStatus;
  stripeChargeId?: string;
  createdAt: string;
  paidAt?: string;
}

function registryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
}
function FILE(): string {
  return path.join(registryDir(), "invoices.json");
}

async function readInvoices(): Promise<Invoice[]> {
  try {
    const raw = await fs.readFile(FILE(), "utf-8");
    const parsed = JSON.parse(raw) as { invoices?: Invoice[] };
    return Array.isArray(parsed.invoices) ? parsed.invoices : [];
  } catch {
    return [];
  }
}

async function writeInvoices(invoices: Invoice[]): Promise<void> {
  await fs.mkdir(registryDir(), { recursive: true });
  await fs.writeFile(FILE(), JSON.stringify({ invoices, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
}

export async function listInvoices(): Promise<Invoice[]> {
  return readInvoices();
}

export async function createInvoice(opportunityId: string): Promise<Invoice> {
  const [ops, strategy] = await Promise.all([listOpportunities(), readStrategy()]);
  const opp = ops.find((o) => o.id === opportunityId);
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found`);
  const serviceId = isServiceId(opp.serviceId) ? opp.serviceId : DEFAULT_SERVICE;
  const svc = getService(strategy, serviceId);
  if (!svc) throw new Error(`Service ${serviceId} not in strategy`);
  const tier = svc.tiers.find((t) => t.id === opp.tierId) ?? svc.tiers[0]!;
  const invoice: Invoice = {
    id: `inv_${Date.now()}`,
    opportunityId,
    serviceId,
    tierId: tier.id,
    amountCents: tier.priceCents,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  const invoices = await readInvoices();
  invoices.push(invoice);
  await writeInvoices(invoices);
  return invoice;
}

export async function markInvoiceSettled(invoiceId: string, stripeChargeId: string): Promise<Invoice | null> {
  const invoices = await readInvoices();
  const invoice = invoices.find((i) => i.id === invoiceId);
  if (!invoice) return null;
  invoice.status = "paid";
  invoice.stripeChargeId = stripeChargeId;
  invoice.paidAt = new Date().toISOString();
  await writeInvoices(invoices);
  await updateOpportunityStage(invoice.opportunityId, "paid").catch(() => {});
  return invoice;
}

export async function markDelivered(opportunityId: string): Promise<{ invoice: Invoice; opportunity: Opportunity | null }> {
  await updateOpportunityStage(opportunityId, "delivering");
  // Idempotent: reuse an existing open invoice for this opportunity.
  let invoice = (await readInvoices()).find((i) => i.opportunityId === opportunityId && i.status === "open");
  if (!invoice) invoice = await createInvoice(opportunityId);
  await updateOpportunityStage(opportunityId, "invoiced");
  const ops = await listOpportunities();
  const opportunity = ops.find((o) => o.id === opportunityId) ?? null;
  return { invoice, opportunity };
}

/**
 * Attribute a settled Stripe charge to a service line — the webhook-driven
 * path (Aetherdesk rentals/top-ups, and any charge carrying metadata.service).
 * Creates a paid invoice record (deduped by stripeChargeId) so the dashboard's
 * per-service `paid` reflects REAL settled money. Optionally advances a linked
 * opportunity to 'paid' when metadata.opportunityId is present.
 */
export async function attributeSettledCharge(input: {
  stripeChargeId: string;
  amountCents: number;
  serviceId: ServiceId;
  opportunityId?: string;
}): Promise<Invoice> {
  const invoices = await readInvoices();
  const existing = invoices.find((i) => i.stripeChargeId === input.stripeChargeId);
  if (existing) return existing;

  const invoice: Invoice = {
    id: `inv_${Date.now()}`,
    opportunityId: input.opportunityId ?? "",
    serviceId: input.serviceId,
    tierId: "settled-charge",
    amountCents: input.amountCents,
    status: "paid",
    stripeChargeId: input.stripeChargeId,
    createdAt: new Date().toISOString(),
    paidAt: new Date().toISOString(),
  };
  invoices.push(invoice);
  await writeInvoices(invoices);

  if (input.opportunityId) {
    await updateOpportunityStage(input.opportunityId, "paid").catch(() => {});
  }
  return invoice;
}

export interface MissionDashboard {
  revenueUsd: number;
  totalMonthlyTarget: number;
  byService: Record<ServiceId, { target: number; won: number; paid: number }>;
  opportunities: { total: number; byStage: Record<string, number> };
  velocity: { leads: number; won: number; invoiced: number; paid: number };
}

export async function missionDashboard(): Promise<MissionDashboard> {
  const [ops, invoices, strategy] = await Promise.all([listOpportunities(), readInvoices(), readStrategy()]);
  const targets = serviceTargets(strategy);
  const byService: Record<ServiceId, { target: number; won: number; paid: number }> = {
    aetherdesk: { target: targets.aetherdesk, won: 0, paid: 0 },
    maas: { target: targets.maas, won: 0, paid: 0 },
    audit: { target: targets.audit, won: 0, paid: 0 },
    research: { target: targets.research, won: 0, paid: 0 },
  };

  const byStage: Record<string, number> = {};
  for (const o of ops) {
    byStage[o.stage] = (byStage[o.stage] ?? 0) + 1;
    const sid = isServiceId(o.serviceId) ? o.serviceId : DEFAULT_SERVICE;
    if (WON_STAGES.has(o.stage)) {
      byService[sid].won += o.monthlyValue;
    }
  }

  let revenueUsd = 0;
  for (const inv of invoices) {
    if (inv.status === "paid") {
      revenueUsd += Math.round(inv.amountCents / 100);
      byService[inv.serviceId].paid += Math.round(inv.amountCents / 100);
    }
  }

  return {
    revenueUsd,
    totalMonthlyTarget: totalMonthlyTarget(strategy),
    byService,
    opportunities: { total: ops.length, byStage },
    velocity: {
      leads: byStage["lead"] ?? 0,
      won: byStage["won"] ?? 0,
      invoiced: byStage["invoiced"] ?? 0,
      paid: byStage["paid"] ?? 0,
    },
  };
}
