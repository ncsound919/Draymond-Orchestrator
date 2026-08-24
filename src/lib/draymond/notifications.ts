// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Email Notification Service
// ============================================================================
// Sends email alerts and digests via Gmail (Nodemailer), logs every
// notification to the `draymond_notifications` table via Supabase.
//
// Notification types: agent failures, chain completions/failures, trade
// signals, site monitors, daily health digests, and freeform custom alerts.
// ============================================================================

import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createDraymondAdminClient } from './client';
import type { DraymondDashboardSummary } from './types';
import { emitNotificationSent, emitNotificationFailed } from '@/lib/draymond/event-bridge';

// ============================================================================
// TYPES
// ============================================================================

export type NotificationType =
  | 'agent_failure'
  | 'chain_completed'
  | 'chain_failed'
  | 'trade_signal'
  | 'site_down'
  | 'site_recovered'
  | 'health_summary'
  | 'memo'
  | 'custom';

export type NotificationChannel = 'email';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';

export interface NotificationPayload {
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  body: string;
  type: NotificationType;
  priority?: NotificationPriority;
  related_agent_id?: string;
  related_chain_id?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationRecord {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  body: string;
  type: NotificationType;
  priority: NotificationPriority;
  status: string;
  related_agent_id: string | null;
  related_event_id: string | null;
  related_chain_id: string | null;
  metadata: Record<string, unknown>;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface NotificationHistoryFilters {
  type?: NotificationType;
  recipient?: string;
  priority?: NotificationPriority;
  related_agent_id?: string;
  related_chain_id?: string;
  since?: string;
  limit?: number;
}

// ============================================================================
// NOTIFICATION TEMPLATES — Subject Prefixes & Emoji Indicators
// ============================================================================

const TEMPLATE_CONFIG: Record<
  NotificationType,
  { prefix: string; icon: string; color: string }
> = {
  agent_failure:   { prefix: 'AGENT FAILURE',   icon: '\u{1F6A8}', color: '#dc2626' },
  chain_completed: { prefix: 'Chain Completed',  icon: '\u2705',    color: '#16a34a' },
  chain_failed:    { prefix: 'Chain Failed',     icon: '\u274C',    color: '#dc2626' },
  trade_signal:    { prefix: 'Trade Signal',     icon: '\u{1F4C8}', color: '#2563eb' },
  site_down:       { prefix: 'SITE DOWN',        icon: '\u{1F534}', color: '#dc2626' },
  site_recovered:  { prefix: 'Site Recovered',   icon: '\u{1F7E2}', color: '#16a34a' },
  health_summary:  { prefix: 'Health Digest',    icon: '\u{1F4CA}', color: '#7c3aed' },
  memo:            { prefix: 'Memo',             icon: '\u{1F4DD}', color: '#0891b2' },
  custom:          { prefix: 'Notification',     icon: '\u{1F514}', color: '#6b7280' },
};

const PRIORITY_LABELS: Record<NotificationPriority, { label: string; bgColor: string }> = {
  low:      { label: 'LOW',      bgColor: '#e5e7eb' },
  normal:   { label: 'NORMAL',   bgColor: '#dbeafe' },
  high:     { label: 'HIGH',     bgColor: '#fef3c7' },
  critical: { label: 'CRITICAL', bgColor: '#fee2e2' },
};

// ============================================================================
// TRANSPORTER — Singleton Gmail via Nodemailer
// ============================================================================

let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (_transporter) return _transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user) {
    throw new Error('[Draymond Notifications] Missing env var: GMAIL_USER');
  }
  if (!pass) {
    throw new Error('[Draymond Notifications] Missing env var: GMAIL_APP_PASSWORD');
  }

  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  return _transporter;
}

// ============================================================================
// GMAIL API (OAuth) — preferred send path
// ============================================================================
// The fleet authenticates to Gmail via a Google OAuth refresh token (from the
// hermes-proxy consent flow, stored at ~/.hermes-gateway/google-token.json).
// SMTP app passwords were never stable here, so when GMAIL_USE_OAUTH=1 AND a
// token file exists we send through the Gmail REST API instead. Falls back to
// SMTP (getTransporter) when OAuth is unavailable.

interface GmailTokenFile {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  access_token?: string;
  expires_at?: number;
}

function gmailTokenFile(): string {
  return (
    process.env.GMAIL_OAUTH_TOKEN_FILE ??
    process.env.GOOGLE_TOKEN_FILE ??
    path.join(os.homedir(), '.hermes-gateway', 'google-token.json')
  );
}

/** True when the Gmail-API OAuth path is enabled AND a token file exists. */
async function gmailOAuthEnabled(): Promise<boolean> {
  if (process.env.GMAIL_USE_OAUTH !== '1') return false;
  try {
    const raw = await readFile(gmailTokenFile(), 'utf8');
    const tok = JSON.parse(raw) as GmailTokenFile;
    return !!(tok && tok.refresh_token);
  } catch {
    return false;
  }
}

/** Return a fresh Gmail access token, exchanging the refresh token when expired. */
async function getGmailAccessToken(): Promise<{ access_token: string; token: GmailTokenFile }> {
  const file = gmailTokenFile();
  const raw = await readFile(file, 'utf8');
  const token = JSON.parse(raw) as GmailTokenFile;
  if (!token.refresh_token) throw new Error('[Gmail OAuth] no refresh_token in token file');

  const clientId = token.client_id ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = token.client_secret ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('[Gmail OAuth] token file missing client_id/client_secret');

  if (token.access_token && token.expires_at && Date.now() < token.expires_at - 60_000) {
    return { access_token: token.access_token, token };
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`[Gmail OAuth] token refresh failed HTTP ${res.status}: ${txt.slice(0, 160)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  token.access_token = data.access_token;
  token.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
  await writeFile(file, JSON.stringify(token, null, 2), 'utf8');
  return { access_token: data.access_token, token };
}

/** Send an HTML email through the Gmail REST API (OAuth bearer). */
async function sendViaGmailApi(opts: { to: string; subject: string; html: string }): Promise<void> {
  const { access_token } = await getGmailAccessToken();
  const from = process.env.GMAIL_USER || 'tap4500@gmail.com';
  const raw = [
    `To: ${opts.to}`,
    `From: ${from}`,
    `Subject: ${opts.subject.replace(/\r?\n/g, ' ')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    opts.html,
  ].join('\r\n');
  const encoded = Buffer.from(raw, 'utf8').toString('base64url');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encoded }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`[Gmail API] send failed HTTP ${res.status}: ${txt.slice(0, 160)}`);
  }
}

/** Send an HTML email: Gmail API (OAuth) preferred, SMTP fallback. */
async function sendEmailHtml(opts: { to: string; subject: string; html: string }): Promise<void> {
  if (await gmailOAuthEnabled()) {
    try {
      await sendViaGmailApi(opts);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Draymond Notifications] Gmail API send failed (${message}) — falling back to SMTP`);
    }
  }
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `Draymond Orchestrator <${process.env.GMAIL_USER}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}

// ============================================================================
// HTML EMAIL RENDERER
// ============================================================================

/**
 * Build a mobile-friendly HTML email body.
 * Uses inline styles for maximum email-client compatibility.
 */
function renderEmailHtml(
  type: NotificationType,
  subject: string,
  body: string,
  priority: NotificationPriority,
  metadata?: Record<string, unknown>
): string {
  // Defensive: an unknown/invalid type or priority must never crash the email
  // renderer (that crash silently turned every subsequent alert into "failed").
  const tpl = TEMPLATE_CONFIG[type] ?? TEMPLATE_CONFIG.custom;
  const pri = PRIORITY_LABELS[priority] ?? PRIORITY_LABELS.normal;

  const metadataRows = metadata && Object.keys(metadata).length > 0
    ? Object.entries(metadata)
        .map(
          ([key, value]) =>
            `<tr>
              <td style="padding:6px 12px;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(key)}</td>
              <td style="padding:6px 12px;color:#111827;font-size:13px;word-break:break-word;">${escapeHtml(String(value))}</td>
            </tr>`
        )
        .join('')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

  <!-- Header bar -->
  <tr>
    <td style="background:${tpl.color};padding:20px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="color:#ffffff;font-size:20px;font-weight:700;line-height:1.3;">
            ${tpl.icon}&nbsp; ${escapeHtml(tpl.prefix)}
          </td>
          <td align="right" style="vertical-align:middle;">
            <span style="display:inline-block;background:${pri.bgColor};color:#111827;font-size:11px;font-weight:700;padding:4px 10px;border-radius:9999px;letter-spacing:0.5px;">
              ${pri.label}
            </span>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Subject -->
  <tr>
    <td style="padding:24px 24px 8px;">
      <h2 style="margin:0;font-size:18px;font-weight:600;color:#111827;line-height:1.4;">
        ${escapeHtml(subject)}
      </h2>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:8px 24px 24px;">
      <div style="font-size:15px;line-height:1.7;color:#374151;white-space:pre-line;">
${escapeHtml(body)}
      </div>
    </td>
  </tr>

  ${metadataRows ? `
  <!-- Metadata table -->
  <tr>
    <td style="padding:0 24px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <tr>
          <td colspan="2" style="background:#f9fafb;padding:8px 12px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">
            Details
          </td>
        </tr>
        ${metadataRows}
      </table>
    </td>
  </tr>` : ''}

  <!-- Footer -->
  <tr>
    <td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
        Sent by Draymond Orchestrator &middot; ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Render the daily health digest as a structured HTML email.
 */
function renderHealthDigestHtml(summary: DraymondDashboardSummary): string {
  const tpl = TEMPLATE_CONFIG.health_summary;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const agentHealthPct =
    summary.total_agents > 0
      ? Math.round((summary.healthy_agents / summary.total_agents) * 100)
      : 0;

  const agentHealthColor =
    agentHealthPct >= 90 ? '#16a34a' : agentHealthPct >= 70 ? '#ca8a04' : '#dc2626';

  const topEventsHtml = summary.top_events.length > 0
    ? summary.top_events
        .slice(0, 8)
        .map((evt) => {
          const sevColor =
            evt.severity === 'critical' ? '#dc2626'
            : evt.severity === 'error' ? '#ef4444'
            : evt.severity === 'warning' ? '#ca8a04'
            : '#6b7280';
          return `<tr>
            <td style="padding:6px 12px;font-size:13px;">
              <span style="display:inline-block;background:${sevColor};color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;text-transform:uppercase;">${escapeHtml(evt.severity)}</span>
            </td>
            <td style="padding:6px 12px;font-size:13px;color:#374151;word-break:break-word;">
              ${escapeHtml(evt.message.slice(0, 120))}
            </td>
          </tr>`;
        })
        .join('')
    : `<tr><td style="padding:12px;font-size:13px;color:#9ca3af;" colspan="2">No warning/error/critical events in the last 24h.</td></tr>`;

  const confidenceDisplay =
    summary.avg_confidence_last_24h !== null
      ? `${(summary.avg_confidence_last_24h * 100).toFixed(1)}%`
      : 'N/A';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Draymond Health Digest</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

  <!-- Header -->
  <tr>
    <td style="background:${tpl.color};padding:20px 24px;">
      <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${tpl.icon}&nbsp; Daily Health Digest</p>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">${escapeHtml(dateStr)}</p>
    </td>
  </tr>

  <!-- KPI Cards -->
  <tr>
    <td style="padding:24px 24px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${renderKpiCell('Agents', `${summary.healthy_agents}/${summary.total_agents}`, agentHealthColor)}
          ${renderKpiCell('Degraded', String(summary.degraded_agents), summary.degraded_agents > 0 ? '#ca8a04' : '#16a34a')}
          ${renderKpiCell('Stalled', String(summary.stalled_agents), summary.stalled_agents > 0 ? '#dc2626' : '#16a34a')}
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:8px 24px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${renderKpiCell('Actions (24h)', String(summary.actions_last_24h), '#2563eb')}
          ${renderKpiCell('Pending Review', String(summary.pending_actions), summary.pending_actions > 0 ? '#ca8a04' : '#6b7280')}
          ${renderKpiCell('Avg Confidence', confidenceDisplay, '#7c3aed')}
        </tr>
      </table>
    </td>
  </tr>

  <!-- Activity Row -->
  <tr>
    <td style="padding:0 24px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          ${renderKpiCell('Events (24h)', String(summary.events_last_24h), '#6b7280')}
          ${renderKpiCell('Handoffs (24h)', String(summary.handoffs_last_24h), '#6b7280')}
          <td width="33%" style="padding:0 4px;"></td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Top Events -->
  <tr>
    <td style="padding:0 24px 24px;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#111827;">Recent Alerts</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        ${topEventsHtml}
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:16px 24px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
        Sent by Draymond Orchestrator &middot; ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Render a single KPI cell for the digest grid. */
function renderKpiCell(label: string, value: string, color: string): string {
  return `<td width="33%" style="padding:0 4px;">
    <div style="background:#f9fafb;border-radius:8px;padding:12px;text-align:center;">
      <p style="margin:0;font-size:22px;font-weight:700;color:${color};">${escapeHtml(value)}</p>
      <p style="margin:4px 0 0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;">${escapeHtml(label)}</p>
    </div>
  </td>`;
}

/** Escape HTML special characters. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// CORE: sendNotification
// ============================================================================

/**
 * Send an email notification and log it to the `draymond_notifications` table.
 *
 * Flow:
 * 1. Insert a pending notification record into Supabase
 * 2. Send the email via Nodemailer
 * 3. Update the record with `sent_at` on success or `error_message` on failure
 *
 * @returns The notification record (with sent_at or error_message populated)
 */
export async function sendNotification(
  payload: NotificationPayload
): Promise<NotificationRecord> {
  // Validate recipient against email header injection
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(payload.recipient) || /[\r\n]/.test(payload.recipient)) {
    throw new Error(
      `[Draymond Notifications] Invalid recipient email: "${payload.recipient}"`
    );
  }

  const supabase = createDraymondAdminClient();
  const priority = payload.priority ?? 'normal';

  // 1. Insert pending notification
  const { data: record, error: insertError } = await supabase
    .from('draymond_notifications')
    .insert({
      channel: payload.channel,
      recipient: payload.recipient,
      subject: payload.subject,
      body: payload.body,
      type: payload.type,
      priority,
      status: 'pending',
      related_agent_id: payload.related_agent_id ?? null,
      related_chain_id: payload.related_chain_id ?? null,
      metadata: payload.metadata ?? {},
    })
    .select()
    .single();

  if (insertError || !record) {
    console.error(
      '[Draymond Notifications] Failed to insert notification record:',
      insertError?.message
    );
    throw new Error(
      `Failed to log notification: ${insertError?.message ?? 'no data returned'}`
    );
  }

  const notificationId = (record as NotificationRecord).id;

  // 2. Send email
  try {
    const html = renderEmailHtml(
      payload.type,
      payload.subject,
      payload.body,
      priority,
      payload.metadata
    );

    await sendEmailHtml({
      to: payload.recipient,
      subject: `${(TEMPLATE_CONFIG[payload.type] ?? TEMPLATE_CONFIG.custom).icon} [${(TEMPLATE_CONFIG[payload.type] ?? TEMPLATE_CONFIG.custom).prefix}] ${payload.subject}`,
      html,
    });

    // 3a. Mark as sent
    const { data: updated, error: updateError } = await supabase
      .from('draymond_notifications')
      .update({ sent_at: new Date().toISOString(), status: 'sent' })
      .eq('id', notificationId)
      .select()
      .single();

    if (updateError) {
      console.error(
        '[Draymond Notifications] Failed to update sent_at:',
        updateError.message
      );
    }

    emitNotificationSent(notificationId, payload.type, payload.subject, priority, payload.recipient);

    return (updated ?? record) as NotificationRecord;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    console.error(
      `[Draymond Notifications] Email send failed for ${notificationId}: ${errorMessage}`
    );

    const { error: updateError } = await supabase
      .from('draymond_notifications')
      .update({ error_message: errorMessage, status: 'failed' })
      .eq('id', notificationId);

    if (updateError) {
      console.error(
        '[Draymond Notifications] Failed to update error_message:',
        updateError.message
      );
    }

    emitNotificationFailed(notificationId, payload.type, payload.subject, errorMessage);

    return { ...(record as NotificationRecord), status: 'failed', error_message: errorMessage };
  }
}

// ============================================================================
// CONVENIENCE: sendAlertEmail
// ============================================================================

/**
 * Quick-fire alert email. Minimal arguments required.
 *
 * @example
 * ```ts
 * await sendAlertEmail(
 *   'admin@upliftlab.com',
 *   'Agent Claude-Researcher is down',
 *   'The agent has missed 5 consecutive heartbeats.',
 *   'agent_failure',
 *   { priority: 'critical', agent_id: 'abc-123' }
 * );
 * ```
 */
export async function sendAlertEmail(
  recipient: string,
  subject: string,
  body: string,
  type: NotificationType = 'custom',
  options?: {
    priority?: NotificationPriority;
    related_agent_id?: string;
    related_chain_id?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<NotificationRecord> {
  return sendNotification({
    channel: 'email',
    recipient,
    subject,
    body,
    type,
    priority: options?.priority,
    related_agent_id: options?.related_agent_id,
    related_chain_id: options?.related_chain_id,
    metadata: options?.metadata,
  });
}

// ============================================================================
// CONVENIENCE: sendMemo
// ============================================================================

/**
 * Send a low-urgency memo/update email (type `memo`).
 *
 * Intended for non-urgent informational updates (progress notes, status
 * memos, daily summaries) where a normal alert is overkill. Sends to the
 * given recipient (or DRAYMOND_ALERT_EMAIL if omitted) at low priority.
 *
 * @param subject  Memo subject line.
 * @param body     Memo body text (plain text; rendered as HTML by the service).
 * @param recipient  Optional recipient — defaults to DRAYMOND_ALERT_EMAIL,
 *                   then GMAIL_USER.
 */
export async function sendMemo(
  subject: string,
  body: string,
  recipient?: string
): Promise<NotificationRecord> {
  const to =
    recipient ??
    process.env.DRAYMOND_ALERT_EMAIL ??
    process.env.GMAIL_USER ??
    '';
  if (!to) {
    throw new Error(
      '[Draymond Notifications] sendMemo requires a recipient, DRAYMOND_ALERT_EMAIL, or GMAIL_USER'
    );
  }
  return sendNotification({
    channel: 'email',
    recipient: to,
    subject,
    body,
    type: 'memo',
    priority: 'low',
  });
}

// ============================================================================
// CONVENIENCE: sendHealthDigest
// ============================================================================

/**
 * Send a formatted daily health digest email summarizing the Draymond dashboard.
 *
 * @param recipient  Email address to send the digest to.
 * @param summary    Dashboard summary object (from `getDashboardSummary()`).
 */
export async function sendHealthDigest(
  recipient: string,
  summary: DraymondDashboardSummary
): Promise<NotificationRecord> {
  const supabase = createDraymondAdminClient();

  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const agentHealthPct =
    summary.total_agents > 0
      ? Math.round((summary.healthy_agents / summary.total_agents) * 100)
      : 0;

  const subject = `Daily Digest — ${agentHealthPct}% agents healthy — ${dateLabel}`;

  // Build a plain-text summary for the body column
  const plainBody = [
    `Agents: ${summary.healthy_agents}/${summary.total_agents} healthy (${summary.degraded_agents} degraded, ${summary.stalled_agents} stalled)`,
    `Actions (24h): ${summary.actions_last_24h} total, ${summary.pending_actions} pending review`,
    `Events (24h): ${summary.events_last_24h}`,
    `Handoffs (24h): ${summary.handoffs_last_24h}`,
    `Avg Confidence: ${summary.avg_confidence_last_24h !== null ? (summary.avg_confidence_last_24h * 100).toFixed(1) + '%' : 'N/A'}`,
    '',
    summary.top_events.length > 0
      ? `Recent alerts:\n${summary.top_events.slice(0, 5).map((e) => `  [${e.severity.toUpperCase()}] ${e.message.slice(0, 100)}`).join('\n')}`
      : 'No warning/error/critical events in the last 24h.',
  ].join('\n');

  // 1. Insert notification record
  const { data: record, error: insertError } = await supabase
    .from('draymond_notifications')
    .insert({
      channel: 'email' as NotificationChannel,
      recipient,
      subject,
      body: plainBody,
      type: 'health_summary' as NotificationType,
      priority: 'normal' as NotificationPriority,
      status: 'pending',
      metadata: {
        total_agents: summary.total_agents,
        healthy_agents: summary.healthy_agents,
        degraded_agents: summary.degraded_agents,
        stalled_agents: summary.stalled_agents,
        actions_last_24h: summary.actions_last_24h,
        pending_actions: summary.pending_actions,
        events_last_24h: summary.events_last_24h,
        handoffs_last_24h: summary.handoffs_last_24h,
        avg_confidence_last_24h: summary.avg_confidence_last_24h,
      },
    })
    .select()
    .single();

  if (insertError || !record) {
    throw new Error(
      `Failed to log health digest notification: ${insertError?.message ?? 'no data returned'}`
    );
  }

  const notificationId = (record as NotificationRecord).id;

  // 2. Send the digest email with rich HTML
  try {
    const html = renderHealthDigestHtml(summary);

    await sendEmailHtml({
      to: recipient,
      subject: `\u{1F4CA} [Health Digest] ${subject}`,
      html,
    });

    // 3a. Mark as sent
    const { data: updated, error: updateError } = await supabase
      .from('draymond_notifications')
      .update({ sent_at: new Date().toISOString(), status: 'sent' })
      .eq('id', notificationId)
      .select()
      .single();

    if (updateError) {
      console.error(
        '[Draymond Notifications] Failed to update digest sent_at:',
        updateError.message
      );
    }

    return (updated ?? record) as NotificationRecord;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    const { error: updateError } = await supabase
      .from('draymond_notifications')
      .update({ error_message: errorMessage, status: 'failed' })
      .eq('id', notificationId);

    if (updateError) {
      console.error(
        '[Draymond Notifications] Failed to update digest error_message:',
        updateError.message
      );
    }

    console.error(
      `[Draymond Notifications] Health digest send failed:`,
      errorMessage
    );

    return { ...(record as NotificationRecord), status: 'failed' as const, error_message: errorMessage };
  }
}

// ============================================================================
// INGEST: ingestWorkerReportEmail
// ============================================================================

/**
 * Ingest a worker report delivered by email (the durable file-delivery loop
 * Open Chat uses instead of, or in addition to, the API). The subject must
 * carry the task id in `[OpenChat: <task_id>]`; the body becomes the result
 * summary and the attachment URLs become artifact refs.
 *
 * Only tasks currently `claimed` or `in_progress` are updated, so a
 * re-delivered email can never overwrite an already-completed task.
 *
 * @returns `{ ok: true, task_id }` on success, or `{ ok: false, error }`.
 */
export async function ingestWorkerReportEmail(
  subject: string,
  body: string,
  artifactRefs: string[] = [],
): Promise<{ ok: boolean; task_id?: string; error?: string }> {
  const m = /\[OpenChat:\s*([A-Za-z0-9_-]+)\]/i.exec(subject ?? '');
  if (!m) return { ok: false, error: 'no task id in subject' };
  const taskId = m[1];
  const db = createDraymondAdminClient();
  const { data, error } = await db
    .from('draymond_worker_tasks')
    .update({
      status: 'completed',
      result: { summary: String(body ?? '').slice(0, 2000) },
      artifact_refs: artifactRefs,
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .in('status', ['claimed', 'in_progress'])
    .select();
  if (error) {
    throw new Error(`Failed to ingest worker report email: ${error.message}`);
  }
  return data?.length ? { ok: true, task_id: taskId } : { ok: false, error: 'task not found or not active' };
}

// ============================================================================
// QUERY: getNotificationHistory
// ============================================================================

/**
 * Query past notifications with optional filters.
 * Results are ordered by `created_at` descending (most recent first).
 *
 * @example
 * ```ts
 * // Get the 20 most recent critical notifications
 * const history = await getNotificationHistory({ priority: 'critical', limit: 20 });
 * ```
 */
export async function getNotificationHistory(
  filters?: NotificationHistoryFilters
): Promise<NotificationRecord[]> {
  const supabase = createDraymondAdminClient();
  const safeLimit = Math.min(Math.max(filters?.limit ?? 50, 1), 200);

  let query = supabase
    .from('draymond_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (filters?.type) query = query.eq('type', filters.type);
  if (filters?.recipient) query = query.eq('recipient', filters.recipient);
  if (filters?.priority) query = query.eq('priority', filters.priority);
  if (filters?.related_agent_id) query = query.eq('related_agent_id', filters.related_agent_id);
  if (filters?.related_chain_id) query = query.eq('related_chain_id', filters.related_chain_id);
  if (filters?.since) query = query.gte('created_at', filters.since);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to query notification history: ${error.message}`);
  }

  return (data ?? []) as NotificationRecord[];
}
