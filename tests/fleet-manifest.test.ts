import { describe, expect, it, afterEach, vi } from 'vitest';

// The fleet manifest is CommonJS (loaded by PM2 configs); import it through a
// small createRequire shim so vitest can validate the same object pm2 loads.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadManifest(env = {}) {
  // Load fresh with overridden env so the test can pin the UPLIFT_ROOT.
  const prev = { ...process.env };
  Object.assign(process.env, env);
  const cacheKey = require.resolve('../fleet-manifest.js');
  delete require.cache[cacheKey];
  let manifest;
  try {
    manifest = require('../fleet-manifest.js');
  } finally {
    process.env = prev;
  }
  return manifest;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fleet-manifest (single source of truth for PM2)', () => {
  it('declares every pm2 service exactly once across groups', () => {
    const m = loadManifest();
    const all = [m.CORE_APP, ...m.FLEET_SERVICES, ...m.MARKETING_SERVICES, ...m.BRAIN_SERVICES];
    const names = all.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length); // no duplicates
    expect(names).toContain('draymond');
    expect(names).toContain('deterministic-brain');
    expect(names).toContain('opencode');
    // The full fleet: 1 core + 17 fleet + 7 marketing + 1 brain = 26 apps.
    expect(all).toHaveLength(26);
  });

  it('gives every app the self-healing restart policy', () => {
    const m = loadManifest();
    const all = [m.CORE_APP, ...m.FLEET_SERVICES, ...m.MARKETING_SERVICES, ...m.BRAIN_SERVICES];
    for (const app of all) {
      expect(app.autorestart).toBe(true);
      expect(app.max_restarts).toBe(10);
      expect(app.exp_backoff_restart_delay).toBeGreaterThan(0);
      expect(app.log_date_format).toBe('YYYY-MM-DD HH:mm:ss.SSS');
      expect(app.out_file).toMatch(/-out\.log$/);
      expect(app.error_file).toMatch(/-error\.log$/);
    }
  });

  it('resolves every cwd under UPLIFT_ROOT (no scattered hardcoded roots)', () => {
    const uplift = 'C:\\Users\\User\\Downloads\\Uplift';
    const m = loadManifest();
    const all = [m.CORE_APP, ...m.FLEET_SERVICES, ...m.MARKETING_SERVICES, ...m.BRAIN_SERVICES];
    for (const app of all) {
      if (app.cwd) {
        expect(app.cwd.startsWith(uplift)).toBe(true);
      }
    }
  });

  it('derives paths from an overridable UPLIFT_ROOT', () => {
    const fakeRoot = 'D:\\Fake\\Uplift';
    const m = loadManifest({ UPLIFT_ROOT: fakeRoot });
    expect(m.ORCH_DIR.startsWith(fakeRoot)).toBe(true);
    const bookbridge = (m.FLEET_SERVICES as Array<{ name: string; cwd: string }>).find(
      (a: { name: string }) => a.name === 'bookbridge',
    );
    expect(bookbridge?.cwd.startsWith(fakeRoot)).toBe(true);
  });

  it('keeps the codegen app pinned to the paid opencode Go tier', () => {
    const m = loadManifest();
    const opencode = (m.MARKETING_SERVICES as Array<{ name: string; env: Record<string, string> }>).find(
      (a: { name: string }) => a.name === 'opencode',
    );
    expect(opencode?.env.OPENCODE_MODEL).toBe('opencode/deepseek-v4-flash');
  });

  it('preserves the draymond env pins that protect live state', () => {
    const m = loadManifest();
    const draymond = m.CORE_APP;
    expect(draymond.env.DRAYMOND_DB_PATH).toContain('data\\draymond.db');
    expect(draymond.env.DRAYMOND_REGISTRY_DIR).toContain('\\.draymond');
    expect(draymond.env.GMAIL_USE_OAUTH).toBe('1');
    expect(draymond.env.ALLOW_LOCAL_AGENTS).toBe('1');
  });

  it('cloudflared keeps its slower restart backoff', () => {
    const m = loadManifest();
    const cloudflared = (m.FLEET_SERVICES as Array<{ name: string; restart_delay: number; exp_backoff_restart_delay: number }>).find(
      (a: { name: string }) => a.name === 'cloudflared',
    );
    expect(cloudflared?.restart_delay).toBe(5000);
    expect(cloudflared?.exp_backoff_restart_delay).toBe(200);
  });
});
