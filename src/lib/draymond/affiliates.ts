/**
 * Affiliate system — attribution + commissions for the partner network.
 *
 * Covers two populations with one ledger:
 *   - ACQUISITION partners (referrer, recruiter) who bring clients;
 *   - DELIVERY humans (agent, supervisor) who work the calls, so a supervisor
 *     can earn an override on the volume their agents drive.
 *
 * State lives in .draymond/affiliates.json (JSON-state pattern, no DB), the same
 * way business-pipeline.ts and mission-strategy.ts do. Deterministic and
 * evidence-based: commissions accrue only on SETTLED revenue events, never on
 * pipeline. Payouts are recorded here; the money movement itself runs through
 * Stripe Connect (OpenPartner / Commission Engine), not this module.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { postLedgerEvent } from "./ledger-sync";

export type AffiliateRole = "referrer" | "recruiter" | "supervisor" | "agent";

export interface Affiliate {
  id: string;
  /** Referral code used in ?ref= (unique, lowercase). */
  code: string;
  name: string;
  email?: string;
  role: AffiliateRole;
  /** Supervisor/recruiter this affiliate rolls up to (for overrides). */
  parentId?: string;
  createdAt: string;
  active: boolean;
}

export interface AttributionEvent {
  id: string;
  code: string;
  customerId: string;
  serviceId?: string;
  kind: "signup" | "revenue";
  /** Settled amount in cents (revenue events only). */
  amountCents?: number;
  voiceTier?: string;
  at: string;
}

export type CommissionStatus = "accrued" | "approved" | "paid";

export interface Commission {
  id: string;
  affiliateId: string;
  attributionId: string;
  role: AffiliateRole;
  /** true when this is a downline override rather than the direct commission. */
  override: boolean;
  basisCents: number;
  ratePct: number;
  amountCents: number;
  status: CommissionStatus;
  createdAt: string;
}

interface AffiliateState {
  affiliates: Affiliate[];
  attributions: AttributionEvent[];
  commissions: Commission[];
  updatedAt: string;
}

/**
 * Default commission rate per role, in percent of attributed revenue.
 * A referrer earns recurring share; a recruiter earns on the agents they source;
 * a supervisor earns an override on their team. Agents are paid per minute of
 * talk time (tracked elsewhere), so their revenue share is 0.
 */
export const ROLE_RATES: Record<AffiliateRole, number> = {
  referrer: 20,
  recruiter: 10,
  supervisor: 10,
  agent: 0,
};

/** Override paid to an affiliate's parent when their downline drives revenue. */
export const PARENT_OVERRIDE_PCT = 5;

/**
 * Volume-based tiers, mirroring the Staffing Commission Engine
 * (10% / 15% / 20% by monthly attributed volume). Exposed for programs that
 * price by volume rather than by a flat role rate.
 */
export const COMMISSION_TIERS: Array<{ minMonthlyCents: number; pct: number }> = [
  { minMonthlyCents: 0, pct: 10 },
  { minMonthlyCents: 100_000, pct: 15 },
  { minMonthlyCents: 500_000, pct: 20 },
];

export function tierRate(monthlyVolumeCents: number): number {
  let pct = COMMISSION_TIERS[0]!.pct;
  for (const t of COMMISSION_TIERS) {
    if (monthlyVolumeCents >= t.minMonthlyCents) pct = t.pct;
  }
  return pct;
}

// ── State ────────────────────────────────────────────────────────────────────

function registryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
}
function FILE(): string {
  return path.join(registryDir(), "affiliates.json");
}

function emptyState(): AffiliateState {
  // Must return FRESH arrays every call — a shared sentinel would alias its
  // arrays into every caller and leak state across reads.
  return { affiliates: [], attributions: [], commissions: [], updatedAt: "" };
}

async function readState(): Promise<AffiliateState> {
  try {
    const raw = await fs.readFile(FILE(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<AffiliateState>;
    return {
      affiliates: Array.isArray(parsed.affiliates) ? parsed.affiliates : [],
      attributions: Array.isArray(parsed.attributions) ? parsed.attributions : [],
      commissions: Array.isArray(parsed.commissions) ? parsed.commissions : [],
      updatedAt: parsed.updatedAt ?? "",
    };
  } catch {
    return emptyState();
  }
}

async function writeState(state: AffiliateState): Promise<void> {
  await fs.mkdir(registryDir(), { recursive: true });
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(FILE(), JSON.stringify(state, null, 2), "utf-8");
}

const cents = (n: number): number => Math.round(n * 100);

// ── Affiliates ───────────────────────────────────────────────────────────────

export function normalizeCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export async function listAffiliates(): Promise<Affiliate[]> {
  return (await readState()).affiliates;
}

export async function getAffiliateByCode(code: string): Promise<Affiliate | null> {
  const want = normalizeCode(code);
  return (await readState()).affiliates.find((a) => a.code === want) ?? null;
}

export interface CreateAffiliateInput {
  code: string;
  name: string;
  role: AffiliateRole;
  email?: string;
  parentId?: string;
}

export async function createAffiliate(input: CreateAffiliateInput): Promise<Affiliate> {
  const state = await readState();
  const code = normalizeCode(input.code);
  if (!code) throw new Error("affiliate code required");
  if (state.affiliates.some((a) => a.code === code)) {
    throw new Error(`affiliate code already exists: ${code}`);
  }
  const affiliate: Affiliate = {
    id: `aff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    code,
    name: input.name,
    email: input.email,
    role: input.role,
    parentId: input.parentId,
    createdAt: new Date().toISOString(),
    active: true,
  };
  state.affiliates.push(affiliate);
  await writeState(state);
  return affiliate;
}

export async function setAffiliateActive(id: string, active: boolean): Promise<Affiliate | null> {
  const state = await readState();
  const a = state.affiliates.find((x) => x.id === id);
  if (!a) return null;
  a.active = active;
  await writeState(state);
  return a;
}

// ── Attribution + commissions ────────────────────────────────────────────────

export interface RecordAttributionInput {
  code: string;
  customerId: string;
  serviceId?: string;
  voiceTier?: string;
  /** For revenue events: settled amount in dollars (converted to cents). */
  amountUsd?: number;
}

/**
 * Record a signup (click → signup) or a settled revenue event, and accrue the
 * resulting commissions. Returns the attribution and the commissions created.
 */
export async function recordAttribution(
  kind: "signup" | "revenue",
  input: RecordAttributionInput,
): Promise<{ attribution: AttributionEvent; commissions: Commission[] }> {
  const state = await readState();
  const affiliate = state.affiliates.find((a) => a.code === normalizeCode(input.code));
  if (!affiliate) throw new Error(`unknown affiliate code: ${input.code}`);

  const now = new Date().toISOString();
  const attribution: AttributionEvent = {
    id: `attr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    code: affiliate.code,
    customerId: input.customerId,
    serviceId: input.serviceId,
    kind,
    amountCents: kind === "revenue" && input.amountUsd !== undefined ? cents(input.amountUsd) : undefined,
    voiceTier: input.voiceTier,
    at: now,
  };
  state.attributions.push(attribution);

  const created: Commission[] = [];
  if (kind === "revenue" && attribution.amountCents) {
    const basis = attribution.amountCents;
    const ratePct = ROLE_RATES[affiliate.role];
    if (ratePct > 0) {
      created.push(
        makeCommission(state, affiliate, attribution, false, basis, ratePct),
      );
    }
    // Downline override to the parent, if any.
    if (affiliate.parentId) {
      const parent = state.affiliates.find((a) => a.id === affiliate.parentId);
      if (parent && parent.active) {
        created.push(
          makeCommission(state, parent, attribution, true, basis, PARENT_OVERRIDE_PCT),
        );
      }
    }
  }

  await writeState(state);
  for (const c of created) {
    await postLedgerEvent({
      kind: "commission.accrued",
      id: c.id,
      amountCents: c.amountCents,
      occurredAt: c.createdAt,
      memo: `commission accrued (${c.role}${c.override ? ", override" : ""})`,
    });
  }
  return { attribution, commissions: created };
}

function makeCommission(
  state: AffiliateState,
  affiliate: Affiliate,
  attribution: AttributionEvent,
  override: boolean,
  basisCents: number,
  ratePct: number,
): Commission {
  const commission: Commission = {
    id: `comm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    affiliateId: affiliate.id,
    attributionId: attribution.id,
    role: affiliate.role,
    override,
    basisCents,
    ratePct,
    amountCents: Math.round((basisCents * ratePct) / 100),
    status: "accrued",
    createdAt: new Date().toISOString(),
  };
  state.commissions.push(commission);
  return commission;
}

export async function listCommissions(filter?: {
  affiliateId?: string;
  status?: CommissionStatus;
}): Promise<Commission[]> {
  const all = (await readState()).commissions;
  return all.filter(
    (c) =>
      (!filter?.affiliateId || c.affiliateId === filter.affiliateId) &&
      (!filter?.status || c.status === filter.status),
  );
}

export async function setCommissionStatus(
  id: string,
  status: CommissionStatus,
): Promise<Commission | null> {
  const state = await readState();
  const c = state.commissions.find((x) => x.id === id);
  if (!c) return null;
  c.status = status;
  await writeState(state);
  const kind = status === "paid" ? "payout.paid" : status === "approved" ? "commission.approved" : "commission.accrued";
  await postLedgerEvent({
    kind,
    id: c.id,
    amountCents: c.amountCents,
    occurredAt: new Date().toISOString(),
    memo: `commission ${status}`,
  });
  return c;
}

export interface AffiliateSummary {
  affiliates: { total: number; active: number; byRole: Record<AffiliateRole, number> };
  attributions: { signups: number; revenue: number };
  commissions: { accruedCents: number; approvedCents: number; paidCents: number; totalCents: number };
}

export async function affiliateSummary(): Promise<AffiliateSummary> {
  const state = await readState();
  const byRole: Record<AffiliateRole, number> = { referrer: 0, recruiter: 0, supervisor: 0, agent: 0 };
  for (const a of state.affiliates) byRole[a.role] += 1;

  const sum = (status: CommissionStatus): number =>
    state.commissions.filter((c) => c.status === status).reduce((s, c) => s + c.amountCents, 0);

  const accruedCents = sum("accrued");
  const approvedCents = sum("approved");
  const paidCents = sum("paid");

  return {
    affiliates: {
      total: state.affiliates.length,
      active: state.affiliates.filter((a) => a.active).length,
      byRole,
    },
    attributions: {
      signups: state.attributions.filter((a) => a.kind === "signup").length,
      revenue: state.attributions.filter((a) => a.kind === "revenue").length,
    },
    commissions: {
      accruedCents,
      approvedCents,
      paidCents,
      totalCents: accruedCents + approvedCents + paidCents,
    },
  };
}
