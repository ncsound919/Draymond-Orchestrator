import { describe, expect, it } from 'vitest';
import {
  TokenErrorType,
  classifyTokenError,
  isTokenOrServiceError,
} from '../src/lib/draymond/chain-execution-fallback';

describe('classifyTokenError', () => {
  it('classifies a bare undici transport failure as SERVICE_UNAVAILABLE', () => {
    // The real error a down dependency produces: a chain step returns
    // "fetch failed" (undici wraps ECONNREFUSED). Before this it fell through
    // to UNKNOWN, which is NOT escalated to the brain, so the chain hard-failed.
    expect(classifyTokenError(new Error('fetch failed'))).toBe(TokenErrorType.SERVICE_UNAVAILABLE);
  });

  it('classifies common socket-level failures as SERVICE_UNAVAILABLE', () => {
    for (const msg of [
      'connect ECONNREFUSED 127.0.0.1:8010',
      'getaddrinfo ENOTFOUND sports-steve',
      'socket hang up',
      'request ETIMEDOUT',
    ]) {
      expect(classifyTokenError(msg)).toBe(TokenErrorType.SERVICE_UNAVAILABLE);
    }
  });

  it('classifies a missing credential presented at call time', () => {
    expect(classifyTokenError('HTTP 403: {"error":"No access token provided"}')).toBe(
      TokenErrorType.MISSING_API_KEY,
    );
  });

  it('still classifies config errors as CONFIG_ERROR', () => {
    expect(classifyTokenError('invocation_config.url is required for api_call')).toBe(
      TokenErrorType.CONFIG_ERROR,
    );
    expect(classifyTokenError('SSRF blocked: Blocked private/localhost URL: "localhost"')).toBe(
      TokenErrorType.CONFIG_ERROR,
    );
  });

  it('keeps rate-limit classification', () => {
    expect(classifyTokenError('HTTP 429 Too Many Requests')).toBe(TokenErrorType.RATE_LIMITED);
  });

  it('falls back to UNKNOWN for an unrecognised message', () => {
    expect(classifyTokenError('something entirely unexpected')).toBe(TokenErrorType.UNKNOWN);
  });

  it('escalates transport + credential failures to the brain', () => {
    expect(isTokenOrServiceError(classifyTokenError('fetch failed'))).toBe(true);
    expect(isTokenOrServiceError(classifyTokenError('No access token provided'))).toBe(true);
    expect(isTokenOrServiceError(classifyTokenError('weird'))).toBe(false);
  });
});
