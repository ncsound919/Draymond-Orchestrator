import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkEnv } from '../src/lib/draymond/env-check';

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
];

describe('checkEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('reports all required vars missing when none are set', () => {
    for (const k of REQUIRED) delete process.env[k];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = checkEnv();
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(REQUIRED);
  });

  it('is ok when all required vars are set', () => {
    for (const k of REQUIRED) process.env[k] = 'set';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = checkEnv();
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('lists only the missing required vars', () => {
    for (const k of REQUIRED) process.env[k] = 'set';
    delete process.env.CRON_SECRET;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = checkEnv();
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['CRON_SECRET']);
  });

  it('logs a warning when optional vars are unset', () => {
    for (const k of REQUIRED) process.env[k] = 'set';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    checkEnv();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Optional env vars not set'));
  });
});
