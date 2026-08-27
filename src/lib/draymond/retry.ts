// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Retry Policy with Classification
// ============================================================================
// Industry pattern (Temporal RetryPolicy / NonRetryableErrorTypes, LangChain
// with_retry, OpenAI ModelRetrySettings): classify every failure before
// retrying. Transient failures (network, timeout, 429, 5xx) get retried with
// jittered exponential backoff; fatal failures (4xx, SSRF, validation, auth)
// are never retried — retrying them just wastes runs and spams events.
//
// Used by the chain step loop (chains.ts) and the job scheduler loop
// (scheduler.ts) so the whole fleet shares one classification policy.
// ============================================================================

export type RetryClass = 'retryable' | 'fatal';

/**
 * Classify a failure as retryable or fatal.
 *
 * statusCode (when available) is authoritative:
 *   - 429 and 5xx → retryable (rate limit / transient server error)
 *   - other 4xx   → fatal (never fixed by a retry)
 *
 * Otherwise the message is scanned for known signals:
 *   - retryable: fetch failed, connection resets/refused, timeouts, aborts,
 *     socket hang-up, temporary unavailability
 *   - fatal: SSRF blocks, not-found, missing/required fields, validation,
 *     auth failures
 *
 * Unknown errors default to retryable — the prior behavior (retry on any
 * failure) is preserved for cases we haven't classified yet.
 */
export function classifyRetryable(error: string, statusCode?: number): RetryClass {
  if (typeof statusCode === 'number') {
    if (statusCode === 429 || statusCode >= 500) return 'retryable';
    if (statusCode >= 400 && statusCode < 500) return 'fatal';
  }

  const lower = error.toLowerCase();

  // Retryable network / transient signals.
  if (
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('aborted') ||
    lower.includes('abort') ||
    lower.includes('socket hang up') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('network') ||
    lower.includes('rate limit')
  ) {
    return 'retryable';
  }

  // Fatal signals — retrying these can never succeed.
  if (
    lower.includes('ssrf blocked') ||
    lower.includes('blocked private') ||
    lower.includes('not found') ||
    lower.includes('is required') ||
    lower.includes('field required') ||
    lower.includes('validation') ||
    lower.includes('invalid ') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('not allowed')
  ) {
    return 'fatal';
  }

  return 'retryable';
}

/**
 * Exponential backoff with full jitter, matching Temporal's default shape
 * (InitialInterval × BackoffCoefficient^attempt). Returns milliseconds.
 * Capped at 30s: with max_retries up to 10 the uncapped curve reached ~512s,
 * letting one step blow far past the chain wall-clock budget.
 */
export function retryDelayMs(attempt: number, baseMs = 1000): number {
  const exp = Math.min(baseMs * Math.pow(2, attempt), 30_000);
  return Math.round(exp * (0.5 + Math.random() * 0.5));
}

/**
 * Gate for retry loops: retry only while attempts remain AND the failure is
 * classified as transient.
 */
export function shouldRetryStep(
  attempt: number,
  maxRetries: number,
  error: string,
  statusCode?: number
): boolean {
  if (attempt >= maxRetries) return false;
  return classifyRetryable(error, statusCode) === 'retryable';
}
