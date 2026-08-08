/**
 * Next.js instrumentation hook — runs once at server startup.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run on the Node.js runtime (not Edge).
  if (process.env.NEXT_RUNTIME === 'nodejs' || !process.env.NEXT_RUNTIME) {
    // In-process scheduler tick: keeps the cron engine firing at each job's
    // real scheduled time even when no external service is hitting /api/cron.
    // This is what makes recaps run at 8:05/12:05/20:05/00:05 instead of all
    // flooding at 6am when an external trigger happens to fire.
    try {
      const { startInProcessScheduler } = await import('@/lib/draymond/scheduler');
      startInProcessScheduler();
    } catch (err) {
      console.warn('[scheduler] in-process tick skipped:', err instanceof Error ? err.message : err);
    }
    // OSS error reporting (Sentry — gated on SENTRY_DSN) + crash guard that
    // reports unhandled rejections / uncaught exceptions to the audit trail,
    // ntfy, and Sentry instead of dying silently. PM2 restarts on exit.
    try {
      const { initSentry } = await import('@/lib/sentry');
      await initSentry();
    } catch (err) {
      console.warn('[sentry] startup init skipped:', err instanceof Error ? err.message : err);
    }
    try {
      const { installCrashGuard } = await import('@/lib/crash-guard');
      installCrashGuard();
    } catch (err) {
      console.warn('[crash-guard] install skipped:', err instanceof Error ? err.message : err);
    }

    const { checkEnv } = await import('@/lib/draymond/env-check');
    checkEnv();

    // Recover IDE sessions interrupted by a previous restart (Docker-free).
    // Runs once per process; re-arms stranded decisions and marks dead runs.
    try {
      const { runRecoverySweep } = await import('@/lib/ide/recovery');
      const recovered = await runRecoverySweep();
      if (recovered > 0) {
        console.log(`[IDE] recovered ${recovered} session(s) interrupted by a restart`);
      }
    } catch (err) {
      console.warn('[IDE] recovery sweep skipped:', err instanceof Error ? err.message : err);
    }
  }
}
