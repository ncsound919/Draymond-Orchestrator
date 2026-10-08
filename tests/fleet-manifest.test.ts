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
    const all = [
      m.CORE_APP,
      ...m.FLEET_SERVICES,
      ...m.MARKETING_SERVICES,
      ...m.DSH_SERVICES,
      ...m.BRAIN_SERVICES,
    ];
    const names = all.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length); // no duplicates
    expect(names).toContain('draymond');
    expect(names).toContain('deterministic-brain');
    expect(names).toContain('axiom');
    // The lean fleet (RUN LEAN policy): 1 core + 20 fleet + 5 marketing + 1 dsh
    // + 1 brain = 28. `opencode` was deliberately RETIRED (codegen now routes
    // through Axiom's /v1/chat/completions) and hermes-brain/hermes-proxy were
    // removed — bump this pin deliberately whenever the fleet changes. The SMD
    // PM2 stack (smd/smd-redis/smd-celery/smd-beat/smd-browser) was
    // decommissioned 2026-09-24 (5 apps removed), so marketing went 11 -> 6.
    // 2026-09-27/28 lean pass: bookbridge→synthbook, mutly/uplift-agent/
    // hemp-os/vibe-reality/halofy/buzz-relay/rome dropped (unprovisioned or
    // retired; covered on-demand by the sector lifecycle instead).
    // 2026-09-28: `indy-music` RETIRED — its cwd `agents/IndyMusic-Service` does
    // not exist anywhere in the tree, so pm2 could never start it. The move
    // guard now also checks cwd/interpreter/port, which is how this silently-dead
    // entry was finally surfaced.
    expect(all).toHaveLength(27);
  });

  it('supervises CodeNexus on its canonical 3205 port', () => {
    const m = loadManifest();
    const codenexus = (
      m.MARKETING_SERVICES as Array<{ name: string; script: string; cwd: string; env: Record<string, string> }>
    ).find((a) => a.name === 'codenexus');
    expect(codenexus, 'codenexus must be pm2-managed').toBeDefined();
    expect(codenexus?.env.PORT).toBe('3205');
    expect(codenexus?.cwd).toContain('CodeNexus-main');
    // The node-adapter (not the wrangler worker) is what serves /health on 3205.
    expect(codenexus?.script).toContain('tsx');
  });

  it('gives every app the self-healing restart policy', () => {
    const m = loadManifest();
    const all = [
      m.CORE_APP,
      ...m.FLEET_SERVICES,
      ...m.MARKETING_SERVICES,
      ...m.DSH_SERVICES,
      ...m.BRAIN_SERVICES,
    ];
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
    // Deliberate external roots: Synthbook (the book/knowledge-synthesis app that
    // replaced BookBridge) lives outside UPLIFT_ROOT at C:\Users\User\Downloads\Synthbook,
    // overridable via SYNTHBOOK_DIR. (Recourse now lives under UPLIFT_ROOT at
    // 06_Resources/recourse, so it is no longer an exception.)
    const externalCwds = ['C:\\Users\\User\\Downloads\\Synthbook'];
    const m = loadManifest();
    const all = [
      m.CORE_APP,
      ...m.FLEET_SERVICES,
      ...m.MARKETING_SERVICES,
      ...m.DSH_SERVICES,
      ...m.BRAIN_SERVICES,
    ];
    const norm = (p: string) => p.replace(/\//g, '\\');
    for (const app of all) {
      if (app.cwd) {
        const cwd = norm(app.cwd);
        const rooted =
          cwd.startsWith(uplift) || externalCwds.some((p) => cwd.startsWith(p));
        expect(rooted).toBe(true);
      }
    }
  });

  it('derives paths from an overridable UPLIFT_ROOT', () => {
    const fakeRoot = 'D:\\Fake\\Uplift';
    const m = loadManifest({ UPLIFT_ROOT: fakeRoot });
    expect(m.ORCH_DIR.startsWith(fakeRoot)).toBe(true);
    const rooted = (m.FLEET_SERVICES as Array<{ name: string; cwd: string }>).find(
      (a: { name: string }) => a.name === 'omniresearch',
    );
    expect(rooted?.cwd.startsWith(fakeRoot)).toBe(true);
  });

  it('keeps the codegen app pinned to the Axiom endpoint', () => {
    const m = loadManifest();
    const axiom = (m.DSH_SERVICES as Array<{ name: string; env: Record<string, string> }>).find(
      (a: { name: string }) => a.name === 'axiom',
    );
    expect(axiom?.env.AXIOM_PORT).toBe('3198');
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
