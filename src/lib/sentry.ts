// ============================================================================
// DRAYMOND ERROR REPORTING — Sentry (self-hostable) bridge
// ============================================================================
// Open-source error aggregation. When SENTRY_DSN is configured, crashes and
// failures are captured with context; when unconfigured this is a strict no-op
// (zero cost, zero failure risk) — mirroring the Langfuse bridge in trace.ts.
//
// The SDK is loaded lazily so this module never touches @sentry/nextjs unless
// a DSN is actually set. Observability must never take down the caller.
// ============================================================================

import type { CaptureContext } from '@sentry/nextjs';

type SentryModule = typeof import('@sentry/nextjs');

let _sentry: SentryModule | null = null;

/** True when a Sentry DSN is configured. */
export function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

/** Lazy-load + initialize the SDK (once). Never throws. */
async function sdk(): Promise<SentryModule | null> {
  if (_sentry) return _sentry;
  if (!isSentryConfigured()) return null;
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),
      // Capture uncaught exceptions + unhandled rejections process-wide.
      integrations: [Sentry.globalHandlersIntegration({ onerror: true, onunhandledrejection: true })],
    });
    _sentry = Sentry;
    return _sentry;
  } catch (err) {
    console.warn(`[sentry] init skipped: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Initialize Sentry at process startup (called from src/instrumentation.ts).
 * Installs the global error handlers that feed unhandled exceptions and
 * unhandled rejections to Sentry for aggregation.
 */
export async function initSentry(): Promise<void> {
  await sdk();
}

/** Capture an error/exception with optional context. Strict no-op when unconfigured. */
export async function captureException(err: unknown, context?: CaptureContext): Promise<void> {
  if (!isSentryConfigured()) return;
  const s = await sdk();
  if (!s) return;
  try {
    const error = err instanceof Error ? err : new Error(String(err));
    s.captureException(error, context);
  } catch {
    // Observability must never break the caller.
  }
}

/** Capture a message-level event (e.g. crash guard events). Strict no-op when unconfigured. */
export async function captureMessage(message: string, context?: CaptureContext): Promise<void> {
  if (!isSentryConfigured()) return;
  const s = await sdk();
  if (!s) return;
  try {
    s.captureMessage(message, context);
  } catch {
    // Observability must never break the caller.
  }
}
