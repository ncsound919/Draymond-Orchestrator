/**
 * Fail-soft posting of money events to the finance-connect double-entry ledger.
 *
 * Idempotency is owned by the ledger: it keys every journal entry by
 * `${kind}:${id}`, so re-sending an event is safe and never double-posts.
 * This module must NEVER throw — a ledger outage cannot break the money flow
 * that produced the event. Follows the finance-sync.ts fail-soft pattern.
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
