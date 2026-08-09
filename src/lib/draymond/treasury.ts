/**
 * Treasury — the settled-cash pulse for the 4 revenue engines.
 *
 * Pulls Stripe charges via the REST API (no SDK dependency), merges them into
 * the shared ledger (treasury-state.ts — the same ledger the real-time webhook
 * writes), and exposes the total so the business pipeline and workplace recaps
 * show REAL money — never estimates.
 *
 * Discipline (matches business-pipeline.ts):
 *   - Only settled charges count. Pipeline value is not revenue.
 *   - When STRIPE_SECRET_KEY is unset the pulse records "not configured" and
 *     returns 0 — it never fabricates a number.
 *   - Every pulse writes a self-learning outcome for the audit trail.
 */

import { readState, writeState, recomputeRevenueFromLedger, type TreasuryState } from "./treasury-state";

/** Raw Stripe charge shape (subset we need — no SDK types). */
interface StripeCharge {
  id: string;
  amount: number; // cents
  currency: string;
  status: string;
  refunded?: boolean;
  created: number;
  metadata?: Record<string, string>;
}

function platformFromMetadata(metadata: Record<string, string> | undefined): TreasuryState["charges"][string]["platform"] {
  const value = (metadata?.platform ?? metadata?.product ?? "").toLowerCase();
  if (value.includes("health")) return "health";
  if (value.includes("wealth")) return "wealth";
  if (value.includes("justice")) return "justice";
  return "cross-platform";
}

/**
 * Pull Stripe charges within [since, until]. Paginates via `starting_after`.
 * Throws on network/API errors (caller records the outcome).
 */
export async function fetchStripeCharges(since: number, until: number): Promise<StripeCharge[]> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY not configured");
  if (until < since) throw new Error(`invalid window: since ${since} > until ${until}`);

  const charges: StripeCharge[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 20; page++) {
    const url = new URL("https://api.stripe.com/v1/charges");
    url.searchParams.set("limit", "100");
    url.searchParams.set("created[gte]", String(since));
    url.searchParams.set("created[lte]", String(until));
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);

    const res = await fetch(url, {
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`stripe: HTTP ${res.status}`);
    const data = (await res.json()) as { data: StripeCharge[]; has_more: boolean };
    charges.push(...data.data);
    if (!data.has_more) break;
    const last = data.data.at(-1);
    if (!last) break;
    startingAfter = last.id;
  }
  return charges;
}

export interface TreasuryPulseResult {
  status: TreasuryState["lastPulseStatus"];
  revenueUsd: number;
  newSettled: number;
  totalChargesSeen: number;
  lastPulseAt: string | null;
  error?: string;
  markdown: string;
}

/**
 * Run a treasury pulse: pull Stripe charges since the last pulse (or the
 * configured lookback), merge settled ones into the ledger, recompute revenue.
 * Never throws for unconfigured keys — returns status "not-configured".
 */
export async function runTreasuryPulse(lookbackDays = 30): Promise<TreasuryPulseResult> {
  const state = await readState();
  const now = new Date();

  if (!process.env.STRIPE_SECRET_KEY) {
    state.lastPulseStatus = "not-configured";
    state.lastPulseError = "STRIPE_SECRET_KEY not configured — settled revenue stays 0";
    state.lastPulseAt = now.toISOString();
    await writeState(state);
    await recordTreasuryOutcome(state, 0, 0, false);
    return {
      status: "not-configured",
      revenueUsd: Math.round(state.revenueCents / 100),
      newSettled: 0,
      totalChargesSeen: Object.keys(state.charges).length,
      lastPulseAt: state.lastPulseAt,
      error: state.lastPulseError,
      markdown: renderTreasuryReport(state, 0),
    };
  }

  const sinceUnix = Math.floor((now.getTime() - lookbackDays * 86_400_000) / 1000);
  const untilUnix = Math.floor(now.getTime() / 1000);

  try {
    const charges = await fetchStripeCharges(sinceUnix, untilUnix);
    let newSettled = 0;
    for (const c of charges) {
      const isRefunded = c.refunded === true;
      const settledStatus = isRefunded ? "refunded" : c.status;
      const existing = state.charges[c.id];
      const amount = c.amount > 0 ? c.amount : 0;
      state.charges[c.id] = {
        id: c.id,
        amountCents: amount,
        currency: c.currency,
        platform: platformFromMetadata(c.metadata),
        status: settledStatus,
        createdAt: new Date(c.created * 1000).toISOString(),
      };
      if (!existing && settledStatus === "succeeded") newSettled += 1;
    }

    state.revenueCents = recomputeRevenueFromLedger(state);
    state.lastPulseStatus = "ok";
    state.lastPulseError = null;
    state.lastPulseAt = now.toISOString();
    await writeState(state);
    await recordTreasuryOutcome(state, newSettled, charges.length, true);

    return {
      status: "ok",
      revenueUsd: Math.round(state.revenueCents / 100),
      newSettled,
      totalChargesSeen: charges.length,
      lastPulseAt: state.lastPulseAt,
      markdown: renderTreasuryReport(state, newSettled),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.lastPulseStatus = "error";
    state.lastPulseError = msg;
    state.lastPulseAt = now.toISOString();
    await writeState(state);
    await recordTreasuryOutcome(state, 0, 0, false);
    return {
      status: "error",
      revenueUsd: Math.round(state.revenueCents / 100),
      newSettled: 0,
      totalChargesSeen: Object.keys(state.charges).length,
      lastPulseAt: state.lastPulseAt,
      error: msg,
      markdown: `# Treasury pulse — ERROR\n\n${msg}\n\nSettled revenue unchanged: $${Math.round(state.revenueCents / 100)}.`,
    };
  }
}

async function recordTreasuryOutcome(state: TreasuryState, newSettled: number, seen: number, success: boolean): Promise<void> {
  try {
    const { recordOutcome } = await import("./self-learning");
    await recordOutcome({
      agentId: "overlay-treasurer",
      kind: "manual",
      summary: `treasury pulse (${state.lastPulseStatus})`,
      success,
      detail:
        state.lastPulseStatus === "ok"
          ? `settled revenue $${Math.round(state.revenueCents / 100)} · ${newSettled} new settled of ${seen} charges`
          : state.lastPulseError ?? "stripe not configured",
    });
  } catch {
    /* learning store best-effort */
  }
}

export function renderTreasuryReport(state: TreasuryState, newSettled: number): string {
  const byPlatform: Record<string, number> = {};
  for (const c of Object.values(state.charges)) {
    if (c.status !== "succeeded") continue;
    byPlatform[c.platform] = (byPlatform[c.platform] ?? 0) + c.amountCents;
  }
  const lines = ["# Treasury — settled revenue", ""];
  if (state.lastPulseStatus === "ok") {
    lines.push(`**Settled to date: $${Math.round(state.revenueCents / 100)}** (${newSettled} new settled)`);
  } else if (state.lastPulseStatus === "not-configured") {
    lines.push("**STRIPE_SECRET_KEY not configured** — settled revenue stays $0. Set the key to start counting real money.");
  } else {
    lines.push(`**Pulse error** — settled revenue frozen at $${Math.round(state.revenueCents / 100)}: ${state.lastPulseError}`);
  }
  lines.push("", "| Platform | Settled (cents) |");
  lines.push("|---|---|");
  for (const [platform, cents] of Object.entries(byPlatform)) lines.push(`| ${platform} | ${cents} |`);
  lines.push("", `Last pulse: ${state.lastPulseAt ?? "never"}`);
  return lines.join("\n");
}
