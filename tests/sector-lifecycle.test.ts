import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../src/lib/draymond/pm2', () => ({
  pm2List: vi.fn(async () => new Map()),
  pm2Stop: vi.fn(async () => true),
  pm2IsOnline: vi.fn(async () => false),
  pm2StartConfig: vi.fn(async () => true),
}));

const mockStopService = vi.fn(async (slug: string) => ({ slug, up: false }));
let mockTracked: Array<{ slug: string; pid: number; startedAt: string; cwd: string; command: string; alive: boolean }> = [];
vi.mock('../src/lib/draymond/service-manager', () => ({
  listTrackedServices: vi.fn(() => mockTracked),
  stopService: (...args: unknown[]) => mockStopService(...(args as [string])),
}));

let lifecycle: typeof import('../src/lib/draymond/sector-lifecycle');
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sector-lifecycle-'));
  process.env.DRAYMOND_REGISTRY_DIR = path.join(tmpDir, '.draymond');
  // fresh import so ORCH + activity state bind to the temp dir
  lifecycle = await import('../src/lib/draymond/sector-lifecycle');
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('sector-lifecycle (pure logic)', () => {
  it('classifies warm services', () => {
    expect(lifecycle.isWarm('draymond')).toBe(true);
    expect(lifecycle.isWarm('keywire')).toBe(true);
    expect(lifecycle.isWarm('litellm')).toBe(true);
    expect(lifecycle.isWarm('agent-browser')).toBe(false);
  });

  it('maps services to sectors', () => {
    expect(lifecycle.serviceSector('agent-browser')).toBe('e2-b2b');
    expect(lifecycle.serviceSector('claw-protect')).toBe('e3-tooling');
    expect(lifecycle.serviceSector('overlay-oncology')).toBe('e4-vertical');
    expect(lifecycle.serviceSector('bookbridge')).toBe('e4-vertical');
    // A pruned/unstartable service is not in the managed table → falls back to ops.
    expect(lifecycle.serviceSector('commission-engine')).toBe('ops');
    expect(lifecycle.serviceSector('unknown-thing')).toBe('ops');
  });

  it('marks heavy services (the ones the design reclaims first)', () => {
    expect(lifecycle.getServiceDef('agent-browser')?.heavy).toBe(true);
    expect(lifecycle.getServiceDef('sub-team')?.heavy).toBe(true);
    expect(lifecycle.getServiceDef('global-lens')?.heavy).toBeFalsy();
  });

  it('tracks activity and computes idle time', () => {
    const slug = 'claw-protect';
    const now = new Date('2026-09-01T12:00:00Z');
    lifecycle.touchService(slug, new Date('2026-09-01T11:50:00Z'));
    expect(lifecycle.serviceIdleMs(slug, now)).toBe(10 * 60 * 1000);
  });

  it('never auto-stops warm or never-touched services', () => {
    expect(lifecycle.shouldStopService('draymond', new Date('2026-09-01T12:00:00Z'))).toBe(false);
    expect(lifecycle.shouldStopService('eidos', new Date('2026-09-01T12:00:00Z'))).toBe(false);
  });

  it('stops an on-demand service only after its idle TTL passes', () => {
    const slug = 'agent-browser';
    const t0 = new Date('2026-09-01T12:00:00Z');
    lifecycle.touchService(slug, t0);
    expect(lifecycle.shouldStopService(slug, t0)).toBe(false);
    expect(lifecycle.shouldStopService(slug, new Date(t0.getTime() + 9 * 60 * 1000))).toBe(false);
    expect(lifecycle.shouldStopService(slug, new Date(t0.getTime() + 11 * 60 * 1000))).toBe(true);
  });

  it('counts services per sector', () => {
    const counts = lifecycle.sectorServiceCounts();
    expect(counts['e2-b2b'].total).toBeGreaterThan(0);
    expect(counts['e2-b2b'].heavy).toBeGreaterThan(0);
    // e1-platform has no managed services since commission-engine was pruned
    // (2026-09-01) — assert the sectors that still have sweepable services.
    expect(counts['e3-tooling'].total).toBeGreaterThan(0);
    expect(counts['e4-vertical'].total).toBeGreaterThan(0);
  });

  it('produces a deterministic observability snapshot', () => {
    const state = lifecycle.sectorState(new Date('2026-09-01T12:00:00Z'));
    expect(state.warm).toContain('keywire');
    expect(state.enabled).toBe(false); // DRAYMOND_SECTOR_LIFECYCLE not set
    expect(state.services.length).toBe(Object.keys(lifecycle.MANAGED_SERVICES).length);
  });

  it('lifecycle is off by default (safety)', () => {
    expect(lifecycle.lifecycleEnabled()).toBe(false);
  });
});

describe('sectorSweep reaps detached call-ups', () => {
  it('stops an over-TTL tracked service pm2 cannot see', async () => {
    mockStopService.mockClear();
    mockTracked = [{
      slug: 'big-homie',
      pid: 424242,
      startedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      cwd: '/tmp/x',
      command: 'python big_homie_web.py',
      alive: true,
    }];
    const res = await lifecycle.sectorSweep(new Date());
    expect(mockStopService).toHaveBeenCalledWith('big-homie');
    expect(res.stopped).toContain('big-homie');
  });

  it('keeps a tracked service inside its TTL', async () => {
    mockStopService.mockClear();
    mockTracked = [{
      slug: 'big-homie',
      pid: 424243,
      startedAt: new Date().toISOString(),
      cwd: '/tmp/x',
      command: 'python big_homie_web.py',
      alive: true,
    }];
    const res = await lifecycle.sectorSweep(new Date());
    expect(mockStopService).not.toHaveBeenCalled();
    expect(res.kept).toContain('big-homie');
  });
});

describe('cold-start pressure gate', () => {
  it('reports host load in [0,1]', () => {
    const load = lifecycle.hostLoad();
    expect(load).toBeGreaterThanOrEqual(0);
    expect(load).toBeLessThanOrEqual(1);
  });

  it('always allows warm services', () => {
    expect(lifecycle.coldStartAllowed('overlay-oncology')).toBe(true);
    expect(lifecycle.coldStartAllowed('deterministic-brain')).toBe(true);
  });

  it('allows on-demand starts when the gate is disabled', () => {
    process.env.DRAYMOND_HOST_PRESSURE_GATE = '0';
    try {
      expect(lifecycle.coldStartAllowed('grader')).toBe(true);
    } finally {
      delete process.env.DRAYMOND_HOST_PRESSURE_GATE;
    }
  });
});
