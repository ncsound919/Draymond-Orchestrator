/**
 * Sale alerts — Draymond tells you when money lands.
 *
 * Scans the treasury ledger for newly-settled charges (status 'succeeded' that
 * haven't fired an alert yet), publishes a real-time ntfy push to the Open-Chat
 * results topic, and sends a sales email. Fires exactly once per charge (the
 * `alertedChargeIds` set in the treasury state dedupes).
 *
 * Wired into:
 *   - The real-time Stripe webhook (app/api/business/stripe-webhook) → instant.
 *   - The daily `treasury_pulse` catch-up (scheduler) → anything the webhook
 *     missed while Draymond was offline.
 *
 * Best-effort everywhere: a failed push/email never breaks the originating flow.
 */

import { readState, writeState, type TreasuryState } from "./treasury-state";

export interface SaleAlert {
  chargeId: string;
  amountUsd: number;
  currency: string;
  platform: "health" | "wealth" | "justice" | "cross-platform";
  occurredAt: string;
}

const PLATFORM_LABEL: Record<SaleAlert["platform"], string> = {
  health: "Overlay Health",
  wealth: "Overlay Wealth",
  justice: "Overlay Justice",
  "cross-platform": "Overlay365",
};

/**
 * Find charges that settled (status 'succeeded') but haven't alerted yet.
 * Sorted oldest-first so alerts arrive in payment order.
 */
export function findNewSettledCharges(state: TreasuryState): SaleAlert[] {
  const alerted = new Set(state.alertedChargeIds ?? []);
  const out: SaleAlert[] = [];
  for (const c of Object.values(state.charges)) {
    if (c.status !== "succeeded") continue;
    if (alerted.has(c.id)) continue;
    out.push({
      chargeId: c.id,
      amountUsd: Math.round(c.amountCents / 100),
      currency: c.currency,
      platform: c.platform,
      occurredAt: c.createdAt,
    });
  }
  return out.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
}

function formatAlertText(alert: SaleAlert): { title: string; message: string } {
  const amount = `$${alert.amountUsd}`;
  const platform = PLATFORM_LABEL[alert.platform] ?? "Overlay365";
  return {
    title: `💰 Sale: ${amount} · ${platform}`,
    message:
      `${platform} received a new payment of ${amount}.\n\n` +
      `Charge ${alert.chargeId.slice(0, 24)} · ${new Date(alert.occurredAt).toLocaleString()}\n\n` +
      `Run /treasury or check the Draymond dashboard for the updated settled-revenue total.`,
  };
}

/** Publish a sale alert to ntfy (results topic) + email. Best-effort. */
export async function publishSaleAlert(alert: SaleAlert): Promise<{ ntfy: boolean; email: boolean; emailError?: string }> {
  const { title, message } = formatAlertText(alert);
  let ntfy = false;
  let email = false;
  let emailError: string | undefined;

  // ntfy push (Open-Chat subscribes to NTFY_TOPIC_RESULTS).
  try {
    const baseUrl = process.env.NTFY_URL;
    const topic = process.env.NTFY_TOPIC_RESULTS;
    if (baseUrl && topic) {
      // `sale` tag → Open Chat auto-speaks it (like recaps). Action button
      // opens the Draymond pipeline/treasury view through the tunnel.
      const actions: Array<Record<string, unknown>> = [];
      const publicUrl = process.env.DRAYMOND_PUBLIC_URL;
      if (publicUrl) {
        actions.push({
          action: "view",
          label: "View revenue",
          url: `${publicUrl.replace(/\/+$/, "")}/api/business/pipeline`,
        });
      }
      const res = await fetch(baseUrl.replace(/\/+$/, ""), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          title,
          message,
          priority: 5,
          tags: ["moneybag", "tada", "sale"],
          click: `${process.env.DRAYMOND_PUBLIC_URL || ""}`,
          ...(actions.length ? { actions } : {}),
        }),
        signal: AbortSignal.timeout(5000),
      });
      ntfy = res.ok;
      if (!res.ok) console.warn(`[sale-alert] ntfy returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`[sale-alert] ntfy publish failed: ${err instanceof Error ? err.message : err}`);
  }

  // Open Chat webhook (the workplace communicator) — pushes the sale straight
  // into an Open Chat conversation when OPENCHAT_WEBHOOK is configured.
  try {
    const webhook = process.env.OPENCHAT_WEBHOOK;
    if (webhook) {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `${title}\n\n${message}`, channel: "workplace", tags: ["sale"] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        // Treat webhook delivery as an extra delivery signal.
        ntfy = ntfy || true;
      }
    }
  } catch (err) {
    console.warn(`[sale-alert] openchat webhook failed: ${err instanceof Error ? err.message : err}`);
  }

  // Sales email.
  try {
    const recipient = process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER ?? "";
    if (recipient) {
      const { sendAlertEmail } = await import("./notifications");
      await sendAlertEmail(recipient, title, message, "custom", {
        priority: "high",
        related_agent_id: "overlay-treasurer",
        metadata: { sale: { chargeId: alert.chargeId, amountUsd: alert.amountUsd, platform: alert.platform } },
      });
      email = true;
    }
  } catch (err) {
    emailError = err instanceof Error ? err.message : String(err);
    console.warn(`[sale-alert] email failed: ${emailError}`);
  }

  return { ntfy, email, emailError };
}

/**
 * Alert on any newly-settled charges and mark them alerted.
 * Returns the alerts that were sent (best-effort — send failures still mark
 * alerted so we don't re-notify forever; the charge stays in the ledger).
 */
export async function sendSaleAlerts(): Promise<SaleAlert[]> {
  const state = await readState();
  const fresh = findNewSettledCharges(state);
  if (fresh.length === 0) return [];

  const sent: SaleAlert[] = [];
  const alerted = new Set(state.alertedChargeIds ?? []);
  for (const alert of fresh) {
    const result = await publishSaleAlert(alert);
    // Only count as "sent" when at least one channel delivered; mark alerted
    // regardless so a stubborn channel can't cause repeat notifications.
    if (result.ntfy || result.email) sent.push(alert);
    alerted.add(alert.chargeId);
    if (fresh.length > 1) {
      // Space out multi-sale bursts so pushes don't arrive as a wall of text.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  state.alertedChargeIds = [...alerted];
  state.lastAlertAt = new Date().toISOString();
  await writeState(state);

  try {
    const { recordOutcome } = await import("./self-learning");
    await recordOutcome({
      agentId: "overlay-treasurer",
      kind: "manual",
      summary: `sale alerts sent (${sent.length})`,
      success: sent.length > 0,
      detail: `sent ${sent.length}/${fresh.length} sale alert(s); revenue now $${Math.round(state.revenueCents / 100)}`,
    });
  } catch {
    /* learning store best-effort */
  }

  return sent;
}
