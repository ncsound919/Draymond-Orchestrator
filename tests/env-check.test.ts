import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkEnv } from '../src/lib/draymond/env-check';

const REQUIRED = ['CRON_SECRET'];

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

  it('reports all set when required and optional vars are present', () => {
    // Every optional var checked by env-check.ts (lines 21-57).
    const OPTIONAL = [
      'NTFY_URL', 'NTFY_TOPIC', 'DRAYMOND_PUBLIC_URL', 'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY', 'QWEN_API_KEY', 'NEWSAPI_KEY', 'GNEWS_API_KEY',
      'WORLDNEWS_API_KEY', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'DRAYMOND_ALERT_EMAIL',
      'UPLIFT_BASE_URL', 'SPORTS_STEVE_URL', 'BET_BUDDY_URL', 'SOCIAL_MEDIA_URL',
      'OMNI_RESEARCH_URL', 'INDY_MUSIC_URL', 'MEGACODE_URL', 'OVERLAY_CHAIN_URL',
      'CCE_ROOT', 'CCE_PYTHON', 'TRADING_AGENTS_PYTHON', 'TRADING_AGENTS_DIR',
      'SUB_TEAM_PYTHON', 'SUB_TEAM_DIR', 'DRAYMOND_REGISTRY_DIR', 'AUDIT_LOG_PATH',
      'DEEPSEEK_API_KEY', 'AETHERDESK_BASE_URL', 'AETHERDESK_API_KEY', 'NTFY_TOPIC_RESULTS',
      'DRAYMOND_DB_PATH', 'DRAYMOND_ADMIN_EMAIL', 'DRAYMOND_ADMIN_PASSWORD', 'DRAYMOND_RELEASES_DIR',
      'NTFY_TOPIC_REPAIR', 'DRAYMOND_REPAIR_IMMEDIATE', 'DRAYMOND_REPAIR_AT_FAILURE',
      'DRAYMOND_REPAIR_AT_FAILURE_TIMEOUT_MS', 'DRAYMOND_REPAIR_DISPATCH_COOLDOWN_MS',
      'DRAYMOND_REPAIR_REPORT_COOLDOWN_MS',
    ];
    for (const k of REQUIRED) process.env[k] = 'set';
    for (const k of OPTIONAL) process.env[k] = 'set';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = checkEnv();
    expect(result.ok).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('All environment variables are set.'));
  });
});
