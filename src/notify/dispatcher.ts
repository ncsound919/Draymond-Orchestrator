import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Notification dispatcher (S10): replaces direct SMTP sends with a channel
 * cascade that degrades gracefully instead of hammering dead credentials:
 *
 *   1. ntfy      — DRAYMOND_NTFY_URL (fast, works with Open Chat)
 *   2. Apprise   — APPRISE_NOTIFY_URLS (any of 100+ services via CLI)
 *   3. Legacy    — caller-supplied email sender (SMTP/Gmail API) last resort
 *
 * Repeated transport failures are digest-guarded: identical failure
 * signatures alert once per cooldown window instead of every event.
 */

export type DispatchPriority = 'low' | 'normal' | 'high' | 'critical';

export interface DispatchPayload {
  subject: string;
  body: string;
  priority?: DispatchPriority;
  /** Intended human recipient; used by the legacy channel only. */
  recipient?: string;
}

export interface DispatchResult {
  delivered: boolean;
  channel: 'ntfy' | 'apprise' | 'legacy-email' | 'none';
  attempts: Array<{ channel: string; error: string }>;
}

const NTFY_TIMEOUT_MS = Number(process.env.DRAYMOND_NTFY_TIMEOUT_MS) || 8000;
const APPRISE_TIMEOUT_MS = Number(process.env.DRAYMOND_APPRISE_TIMEOUT_MS) || 15000;
/** How long an identical transport-failure signature stays digest-muted. */
const FAILURE_DIGEST_COOLDOWN_MS = Number(process.env.DRAYMOND_NOTIFY_DIGEST_MS) || 24 * 60 * 60 * 1000;

const recentFailureSignatures = new Map<string, number>();

function ntfyPriority(p: DispatchPriority | undefined): number | undefined {
  switch (p) {
    case 'low': return 2;
    case 'high': return 4;
    case 'critical': return 5;
    default: return 3;
  }
}

async function sendViaNtfy(payload: DispatchPayload): Promise<void> {
  const url = process.env.DRAYMOND_NTFY_URL;
  if (!url) throw new Error('DRAYMOND_NTFY_URL not configured');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Title': payload.subject,
      'Priority': String(ntfyPriority(payload.priority)),
      ...(process.env.DRAYMOND_NTFY_TOKEN ? { 'Authorization': `Bearer ${process.env.DRAYMOND_NTFY_TOKEN}` } : {}),
    },
    body: payload.body,
    signal: AbortSignal.timeout(NTFY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

async function sendViaApprise(payload: DispatchPayload): Promise<void> {
  const urls = process.env.APPRISE_NOTIFY_URLS;
  if (!urls) throw new Error('APPRISE_NOTIFY_URLS not configured');
  // Title support varies by schema; fold title into body for safety.
  const body = `${payload.subject}\n\n${payload.body}`;
  await execFileAsync(
    'python',
    ['-m', 'apprise', '-vv', '--title', payload.subject, '--body', body, '-i', urls],
    { timeout: APPRISE_TIMEOUT_MS }
  );
}

/**
 * Deliver through the cascade. `legacyEmail` (when provided) is the caller's
 * existing SMTP/Gmail-API sender and is tried LAST so long-lived mail
 * credentials become an escape hatch rather than the primary path.
 */
export async function dispatchNotification(
  payload: DispatchPayload,
  legacyEmail?: (p: DispatchPayload) => Promise<void>
): Promise<DispatchResult> {
  const attempts: DispatchResult['attempts'] = [];

  const tryChannel = async (
    name: 'ntfy' | 'apprise',
    fn: () => Promise<void>
  ): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push({ channel: name, error: msg });
      digestGuard(name, msg);
      return false;
    }
  };

  if (process.env.DRAYMOND_NTFY_URL) {
    if (await tryChannel('ntfy', () => sendViaNtfy(payload))) {
      return { delivered: true, channel: 'ntfy', attempts };
    }
  }

  if (process.env.APPRISE_NOTIFY_URLS) {
    if (await tryChannel('apprise', () => sendViaApprise(payload))) {
      return { delivered: true, channel: 'apprise', attempts };
    }
  }

  if (legacyEmail) {
    try {
      await legacyEmail(payload);
      return { delivered: true, channel: 'legacy-email', attempts };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      attempts.push({ channel: 'legacy-email', error: msg });
      digestGuard('legacy-email', msg);
    }
  }

  return { delivered: false, channel: 'none', attempts };
}

/**
 * Digest guard: when the same channel fails with the same root cause
 * repeatedly (e.g., Gmail 535 credential rejection), log loudly ONCE per
 * cooldown instead of spamming per event.
 */
function digestGuard(channel: string, error: string): void {
  const sig = `${channel}:${error.slice(0, 120)}`;
  const now = Date.now();
  const seen = recentFailureSignatures.get(sig);
  if (seen && now - seen < FAILURE_DIGEST_COOLDOWN_MS) {
    console.warn(`[notify-dispatcher] ${channel} failed again (digest-muted): ${sig}`);
    return;
  }
  recentFailureSignatures.set(sig, now);
  console.error(`[notify-dispatcher] channel ${channel} failing (will re-alert after cooldown): ${sig}`);
}
