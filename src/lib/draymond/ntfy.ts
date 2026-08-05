// ============================================================================
// DRAYMOND NOTIFICATIONS — ntfy push approval relay
// ============================================================================
// Publishes a human-in-the-loop approval request to ntfy.sh (or a self-hosted
// ntfy server). The Open-Chat app subscribes to the topic and renders the
// HTTP action buttons, which POST back to Draymond's review endpoint.
//
// Security model:
//   - The CRON_SECRET is NEVER embedded in the notification payload. Each
//     action carries a single-use, time-limited review token in its HTTP
//     action headers (X-Review-Token), so a leaked notification cannot be
//     reused to approve arbitrary actions.
//   - Notification publishing is best-effort: a failure to reach ntfy must
//     never fail action submission.
// ============================================================================

import type { DraymondAction } from './types';

/** Published message title — kept in one place so consumers can filter on it. */
export const NTFY_APPROVAL_TITLE = 'Draymond · Approval required';

/** Severity ordering used to pick an ntfy priority level. */
const RISK_PRIORITY: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 3,
  safe: 2,
};

/**
 * Build the ntfy publish payload for an action awaiting human review.
 * Returns `null` when ntfy is not configured (publishing is best-effort).
 */
export function buildApprovalPayload(action: DraymondAction): Record<string, unknown> | null {
  const baseUrl = process.env.NTFY_URL;
  const topic = process.env.NTFY_TOPIC;
  const publicUrl = process.env.DRAYMOND_PUBLIC_URL;

  if (!baseUrl || !topic || !publicUrl) {
    return null;
  }

  const reviewPath = `/api/v1/actions/${action.id}/review`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (action.review_token) {
    headers['X-Review-Token'] = action.review_token;
  }

  const body = JSON.stringify({ approved: true, reviewer_id: 'open-chat' });

  return {
    topic,
    title: NTFY_APPROVAL_TITLE,
    message: `${action.description}\n\nRisk: ${action.risk_level} · Confidence: ${action.confidence_score}`,
    priority: RISK_PRIORITY[action.risk_level] ?? 3,
    tags: ['wrench'],
    actions: [
      {
        action: 'http',
        label: 'Approve',
        url: `${publicUrl}${reviewPath}`,
        method: 'POST',
        headers,
        body,
        clear: true,
      },
      {
        action: 'http',
        label: 'Reject',
        url: `${publicUrl}${reviewPath}`,
        method: 'POST',
        headers,
        body: JSON.stringify({ approved: false, reviewer_id: 'open-chat' }),
        clear: true,
      },
    ],
  };
}

/**
 * Publish an approval notification for a pending action.
 * Best-effort: resolves `true` on 2xx, `false` when unconfigured or on failure.
 * Never throws.
 */
export async function publishApprovalNotification(action: DraymondAction): Promise<boolean> {
  const baseUrl = process.env.NTFY_URL;
  const payload = buildApprovalPayload(action);

  if (!baseUrl || !payload) {
    return false;
  }

  try {
    // POST to the ntfy root URL — the topic lives in the JSON body.
    const res = await fetch(baseUrl.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.warn(`[ntfy] Publish returned ${res.status} for action ${action.id}`);
      return false;
    }

    return true;
  } catch (err) {
    console.warn(`[ntfy] Publish failed for action ${action.id}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
