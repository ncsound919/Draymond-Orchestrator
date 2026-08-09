/**
 * Treasury state — shared ledger for settled revenue.
 *
 * Both the daily `treasury_pulse` pull (treasury.ts) and the real-time Stripe
 * webhook (app/api/business/stripe-webhook) write to the SAME ledger so push and
 * pull stay consistent. This module owns the JSON file + the read/write/recompute
 * helpers; treasury.ts owns the fetch + reporting logic.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Resolved lazily so tests (fresh temp dirs per case) and prod both work. */
function treasuryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
}
function FILE(): string {
  return path.join(treasuryDir(), "treasury.json");
}

export interface SettledCharge {
  id: string;
  amountCents: number;
  currency: string;
  platform: "health" | "wealth" | "justice" | "cross-platform";
  status: string;
  createdAt: string;
}

export interface TreasuryState {
  /** Sum of settled, non-refunded charges (cents). */
  revenueCents: number;
  /** id → settled charge ledger (dedupe + refund tracking). */
  charges: Record<string, SettledCharge>;
  /** Charge ids that already fired a sale alert (so each sale alerts once). */
  alertedChargeIds: string[];
  /** When the last sale alert was published. */
  lastAlertAt: string | null;
  lastPulseAt: string | null;
  lastPulseStatus: "ok" | "not-configured" | "error";
  lastPulseError: string | null;
  updatedAt: string;
}

export function emptyTreasuryState(): TreasuryState {
  return { revenueCents: 0, charges: {}, alertedChargeIds: [], lastAlertAt: null, lastPulseAt: null, lastPulseStatus: "not-configured", lastPulseError: null, updatedAt: new Date().toISOString() };
}

export async function readState(): Promise<TreasuryState> {
  try {
    const raw = await fs.readFile(FILE(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<TreasuryState>;
    return {
      revenueCents: typeof parsed.revenueCents === "number" ? parsed.revenueCents : 0,
      charges: parsed.charges && typeof parsed.charges === "object" ? parsed.charges : {},
      alertedChargeIds: Array.isArray(parsed.alertedChargeIds) ? parsed.alertedChargeIds : [],
      lastAlertAt: parsed.lastAlertAt ?? null,
      lastPulseAt: parsed.lastPulseAt ?? null,
      lastPulseStatus: parsed.lastPulseStatus ?? "not-configured",
      lastPulseError: parsed.lastPulseError ?? null,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return emptyTreasuryState();
  }
}

export async function writeState(state: TreasuryState): Promise<void> {
  await fs.mkdir(treasuryDir(), { recursive: true });
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(FILE(), JSON.stringify(state, null, 2), "utf-8");
}

/** Recompute revenueCents from the ledger (settled + not refunded only). */
export function recomputeRevenueFromLedger(state: TreasuryState): number {
  let total = 0;
  for (const c of Object.values(state.charges)) {
    if (c.status === "succeeded") total += c.amountCents;
  }
  return total;
}

/** Settled revenue to date in USD (used by pipelineSummary / recaps). */
export async function settledRevenueUsd(): Promise<number> {
  const state = await readState();
  return Math.round(state.revenueCents / 100);
}
