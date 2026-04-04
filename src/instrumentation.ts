/**
 * Next.js instrumentation hook — runs once at server startup.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run env checks on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs' || !process.env.NEXT_RUNTIME) {
    const { checkEnv } = await import('@/lib/draymond/env-check');
    checkEnv();
  }
}
