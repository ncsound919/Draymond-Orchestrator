import { describe, expect, it } from 'vitest';
import { classifyRetryable, retryDelayMs, shouldRetryStep } from '../src/lib/draymond/retry';

describe('classifyRetryable', () => {
  it('retries 429 and 5xx status codes', () => {
    expect(classifyRetryable('whatever', 429)).toBe('retryable');
    expect(classifyRetryable('whatever', 500)).toBe('retryable');
    expect(classifyRetryable('whatever', 503)).toBe('retryable');
  });

  it('never retries other 4xx status codes', () => {
    expect(classifyRetryable('whatever', 400)).toBe('fatal');
    expect(classifyRetryable('whatever', 401)).toBe('fatal');
    expect(classifyRetryable('whatever', 403)).toBe('fatal');
    expect(classifyRetryable('whatever', 404)).toBe('fatal');
    expect(classifyRetryable('whatever', 422)).toBe('fatal');
  });

  it('classifies network / timeout messages as retryable', () => {
    expect(classifyRetryable('fetch failed')).toBe('retryable');
    expect(classifyRetryable('ECONNREFUSED')).toBe('retryable');
    expect(classifyRetryable('socket hang up')).toBe('retryable');
    expect(classifyRetryable('Request timed out after 30000ms')).toBe('retryable');
    expect(classifyRetryable('network error')).toBe('retryable');
  });

  it('classifies SSRF / validation / auth messages as fatal', () => {
    expect(classifyRetryable('SSRF blocked: Blocked private/localhost URL')).toBe('fatal');
    expect(classifyRetryable('HTTP 404: {"detail":"Not Found"}')).toBe('fatal');
    expect(classifyRetryable('Field required')).toBe('fatal');
    expect(classifyRetryable('invocation_config.url is required')).toBe('fatal');
    expect(classifyRetryable('Entity foo not found in registry')).toBe('fatal');
    expect(classifyRetryable('Unauthorized')).toBe('fatal');
  });

  it('defaults unknown errors to retryable (preserves prior behavior)', () => {
    expect(classifyRetryable('Some mysterious failure')).toBe('retryable');
  });
});

describe('retryDelayMs', () => {
  it('grows exponentially with attempt', () => {
    const base = 1000;
    const d0 = retryDelayMs(0, base);
    const d1 = retryDelayMs(1, base);
    const d2 = retryDelayMs(2, base);
    expect(d0).toBeLessThanOrEqual(base);
    expect(d1).toBeLessThanOrEqual(base * 2);
    expect(d2).toBeLessThanOrEqual(base * 4);
    expect(d0).toBeGreaterThanOrEqual(base * 0.5);
    expect(d2).toBeGreaterThanOrEqual(base * 4 * 0.5);
    // Jittered: delay is never zero.
    expect(d0).toBeGreaterThan(0);
  });

  it('defaults to 1000ms base', () => {
    expect(retryDelayMs(0)).toBeLessThanOrEqual(1000);
    expect(retryDelayMs(0)).toBeGreaterThan(0);
  });
});

describe('shouldRetryStep', () => {
  it('retries a retryable failure while attempts remain', () => {
    expect(shouldRetryStep(0, 2, 'fetch failed')).toBe(true);
    expect(shouldRetryStep(1, 2, 'fetch failed')).toBe(true);
  });

  it('stops retrying a fatal failure immediately', () => {
    expect(shouldRetryStep(0, 2, 'SSRF blocked: localhost')).toBe(false);
    expect(shouldRetryStep(0, 2, 'HTTP 404: not found', 404)).toBe(false);
  });

  it('stops when attempts are exhausted', () => {
    expect(shouldRetryStep(2, 2, 'fetch failed')).toBe(false);
  });

  it('does not retry when maxRetries is zero', () => {
    expect(shouldRetryStep(0, 0, 'fetch failed')).toBe(false);
  });
});
