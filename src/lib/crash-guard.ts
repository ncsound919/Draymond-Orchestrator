// ============================================================================
// DRAYMOND CRASH GUARD — global process error handling
// ============================================================================
// Autonomous 24/7 operation depends on the process not dying silently.
// These handlers report unhandled rejections and uncaught exceptions to the
// audit trail (draymond_events), a real-time ntfy alert, and Sentry — then
// either continue (rejections) or exit cleanly so PM2 restarts (exceptions in
// production). Every report is fail-soft: a crashed DB must not recurse.
// ============================================================================

import { captureException } from './sentry';

export type CrashEventType = 'unhandled_rejection' | 'uncaught_exception';

export interface CrashReport {
  event_type: CrashEventType;
  message: string;
  stack?: string;
  detail?: unknown;
}

let _installed = false;

function toError(report: CrashReport): Error {
  const err = new Error(`${report.event_type}: ${report.message}`);
  if (report.stack) err.stack = report.stack;
  return err;
}

function sanitizeDetail(detail: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(detail ?? null));
  } catch {
    return String(detail).slice(0, 2000);
  }
}

/**
 * Report a crash through all available channels. Best-effort end-to-end: any
 * failing channel is swallowed so the guard itself never crashes.
 */
export async function reportCrash(report: CrashReport): Promise<void> {
  // 1. Sentry (OSS error aggregation).
  try {
    await captureException(toError(report), { tags: { event_type: report.event_type, component: 'crash-guard' } });
  } catch {
    /* best-effort */
  }

  // 2. Audit trail — a DB failure here must not recurse.
  try {
    const { logEvent } = await import('@/lib/draymond/index');
    await logEvent({
      agent_id: 'draymond',
      category: 'health',
      severity: 'critical',
      event_type: report.event_type,
      message: report.message,
      metadata: { stack: report.stack, detail: sanitizeDetail(report.detail) },
    });
  } catch {
    /* best-effort */
  }

  // 3. Real-time ntfy alert to Open-Chat (fire-and-forget).
  try {
    const { publishIssueNotification } = await import('@/lib/draymond/ntfy');
    publishIssueNotification({
      title: `Draymond · ${report.event_type}`,
      message: `${report.event_type}: ${report.message}`,
      priority: 5,
      tags: ['rotating_light', 'boom'],
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

/** Install the process-wide crash handlers exactly once. */
export function installCrashGuard(): void {
  if (_installed) return;
  _installed = true;

  process.on('unhandledRejection', (reason) => {
    const message =
      reason instanceof Error ? reason.message : `Non-Error value: ${JSON.stringify(reason) ?? String(reason)}`;
    // Report and continue: one bad promise should not take the whole fleet down.
    reportCrash({
      event_type: 'unhandled_rejection',
      message,
      stack: reason instanceof Error ? reason.stack : undefined,
      detail: reason,
    }).catch(() => {});
  });

  process.on('uncaughtException', (err) => {
    const exitCode =
      (err as NodeJS.ErrnoException).code === 'ERR_IPC_DISCONNECTED' ? 0 : 1;
    // In production the process may be in an unknown state — report, flush, and
    // exit so PM2 restarts it cleanly. In dev, keep going.
    const fatal =
      process.env.NODE_ENV === 'production' &&
      !String(process.env.DRAYMOND_CRASH_EXIT ?? '1').startsWith('0');
    reportCrash({
      event_type: 'uncaught_exception',
      message: err.message,
      stack: err.stack,
      detail: { code: (err as NodeJS.ErrnoException).code },
    }).then(() => {
      if (fatal) {
        // Give the async report a moment to flush before the supervisor restarts us.
        setTimeout(() => process.exit(exitCode), 1500);
      }
    });
  });
}
