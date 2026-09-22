/**
 * Fail-soft posting of money events to the ERPNext double-entry ledger.
 *
 * The target is the ERPNext-Ledger finance-connect adapter (02_Pillars/Overlay
 * Finance/ERPNext-Ledger/adapter, port 4100): POST /api/v1/ledger/ingest with
 * { kind, id, amount_cents, occurred_at?, memo? }. This is NOT the separate
 * stale finance-connect under 04_Integrations (port 4000) — that one must not
 * receive ledger posts. Draymond's .env.local/.env.example wire
 * FINANCE_CONNECT_URL to http://127.0.0.1:4100.
 *
 * Idempotency is owned by the ledger: it keys every journal entry by
 * `${kind}:${id}`, so re-sending an event is safe and never double-posts.
 * This module must NEVER throw — a ledger outage cannot break the money flow
 * that produced the event. Follows the finance-sync.ts fail-soft pattern.
 * Inert (returns false, no network call) until FINANCE_CONNECT_URL is set.
 */

export type LedgerEventKind =
  | "charge.settled"
  | "charge.refunded"
  | "commission.accrued"
  | "commission.approved"
  | "commission.reversed"
  | "payout.paid"
  | "payout.failed";

export interface LedgerEvent {
  kind: LedgerEventKind;
  id: string;
  amountCents: number;
  occurredAt?: string;
  memo?: string;
}

function ledgerUrl(): string | undefined {
  return process.env.FINANCE_CONNECT_URL;
}

export function ledgerConfigured(): boolean {
  return Boolean(ledgerUrl());
}

export async function postLedgerEvent(event: LedgerEvent): Promise<boolean> {
  const base = ledgerUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/v1/ledger/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.FINANCE_CONNECT_TOKEN ?? ""}`,
      },
      body: JSON.stringify({
        kind: event.kind,
        id: event.id,
        amount_cents: event.amountCents,
        occurred_at: event.occurredAt,
        memo: event.memo,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
