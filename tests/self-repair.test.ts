import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const originalEnv = { ...process.env };

let tempDir = '';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draymond-repair-'));
  process.env.DRAYMOND_REGISTRY_DIR = tempDir;
  vi.clearAllMocks();
});

afterEach(async () => {
  process.env = { ...originalEnv };
  vi.resetModules();
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

async function loadSelfRepair() {
  vi.resetModules();
  vi.doMock('node:child_process', () => ({ execFile: mocks.execFile }));
  vi.doMock('node:util', () => ({ promisify: (fn: unknown) => fn }));
  return await import('../src/lib/draymond/self-repair');
}

async function readLog() {
  const raw = await fs.readFile(path.join(tempDir, 'repair-log.json'), 'utf-8');
  return JSON.parse(raw) as Array<{ signal: string; status: string; detail: string }>;
}

describe('attemptRepair', () => {
  it('escalates unknown signals', async () => {
    const mod = await loadSelfRepair();
    const attempt = await mod.attemptRepair('weird:signal', 'something odd');

    expect(attempt.status).toBe('escalated');
    expect(attempt.action.name).toBe('escalate');
    expect(attempt.detail).toBe('No known repair for "weird:signal" — something odd (on-call).');
    expect(mocks.execFile).not.toHaveBeenCalled();

    const log = await readLog();
    expect(log).toHaveLength(1);
    expect(log[0].signal).toBe('weird:signal');
    expect(log[0].status).toBe('escalated');
  });

  it('escalates known-but-unsafe repairs', async () => {
    const mod = await loadSelfRepair();
    const attempt = await mod.attemptRepair('monitor:down', 'site down');

    expect(attempt.status).toBe('escalated');
    expect(attempt.detail).toBe('Repair "restart:service" not safe to auto-run — site down (on-call).');
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('escalates safe repairs that have no command to run', async () => {
    const mod = await loadSelfRepair();
    const attempt = await mod.attemptRepair('job:error', 'job failed');

    expect(attempt.status).toBe('escalated');
    expect(attempt.detail).toBe('Repair "retry:job" not safe to auto-run — job failed (on-call).');
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('applies a safe repair command', async () => {
    mocks.execFile.mockResolvedValue('ok');

    const mod = await loadSelfRepair();
    const attempt = await mod.attemptRepair('qa:fail', 'tests failing');

    expect(attempt.status).toBe('applied');
    expect(attempt.detail).toBe('Applied "reindex:qa" for tests failing.');
    expect(mocks.execFile).toHaveBeenCalledWith(
      'npx',
      ['tsx', 'agents/AgentBrowser-main/scripts/run-site-tests.ts', 'all'],
      { timeout: 120_000 },
    );

    const log = await readLog();
    expect(log).toHaveLength(1);
    expect(log[0].status).toBe('applied');
  });

  it('applies the registry reseed command', async () => {
    mocks.execFile.mockResolvedValue('ok');

    const mod = await loadSelfRepair();
    const attempt = await mod.attemptRepair('registry:stale', 'registry old');

    expect(attempt.status).toBe('applied');
    expect(mocks.execFile).toHaveBeenCalledWith(
      'node',
      ['scripts/seed-agents.mjs'],
      { timeout: 120_000 },
    );
  });

  it('escalates when a safe repair command fails', async () => {
    mocks.execFile.mockRejectedValue(new Error('cmd exploded'));

    const mod = await loadSelfRepair();
    const attempt = await mod.attemptRepair('qa:fail', 'tests failing');

    expect(attempt.status).toBe('escalated');
    expect(attempt.detail).toBe('Repair "reindex:qa" failed: cmd exploded (on-call).');
  });
});

describe('repairLog', () => {
  it('returns the most recent entries', async () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({
      id: `rp_${i}`,
      detectedAt: '2026-01-01T00:00:00.000Z',
      signal: `s${i}`,
      action: { name: 'x', service: 'y', command: [] as string[], safe: false },
      status: 'escalated' as const,
      detail: `d${i}`,
    }));
    await fs.writeFile(
      path.join(tempDir, 'repair-log.json'),
      JSON.stringify(entries),
      'utf-8',
    );

    const mod = await loadSelfRepair();
    expect(await mod.repairLog()).toHaveLength(3);
    expect(await mod.repairLog(1)).toEqual([entries[2]]);
  });

  it('returns an empty log when none exists', async () => {
    const mod = await loadSelfRepair();
    expect(await mod.repairLog()).toEqual([]);
  });
});

describe('failure-loop guard', () => {
  it('stops re-applying the same repair once the cooldown threshold is hit', async () => {
    mocks.execFile.mockResolvedValue('ok');
    process.env.DRAYMOND_REPAIR_COOLDOWN_MS = String(10 * 60 * 60 * 1000); // wide cooldown
    process.env.DRAYMOND_REPAIR_MAX_IN_COOLDOWN = '3';

    const mod = await loadSelfRepair();
    await mod.attemptRepair('qa:fail', 'fail 1');
    await mod.attemptRepair('qa:fail', 'fail 2');
    await mod.attemptRepair('qa:fail', 'fail 3');

    // 4th attempt inside the cooldown window must escalate, not re-apply.
    const loop = await mod.attemptRepair('qa:fail', 'fail 4');
    expect(loop.status).toBe('escalated');
    expect(loop.detail).toContain('Repair loop detected for "qa:fail"');
    expect(mocks.execFile).toHaveBeenCalledTimes(3); // not called a 4th time

    // The loop is reported by detectRepairLoops.
    const loops = await mod.detectRepairLoops();
    expect(loops).toHaveLength(1);
    expect(loops[0].signal).toBe('qa:fail');
    expect(loops[0].attempts).toBe(3);
  });

  it('applies a repair registered via DRAYMOND_REPAIR_MAP (learned repairs)', async () => {
    mocks.execFile.mockResolvedValue('ok');
    process.env.DRAYMOND_REPAIR_MAP = JSON.stringify({
      'learner:fix': {
        name: 'learner:fix',
        service: 'learner',
        command: ['node', 'scripts/learner-fix.mjs'],
        safe: true,
      },
    });

    const mod = await loadSelfRepair();
    const attempt = await mod.attemptRepair('learner:fix', 'learned failure');

    expect(attempt.status).toBe('applied');
    expect(mocks.execFile).toHaveBeenCalledWith('node', ['scripts/learner-fix.mjs'], { timeout: 120_000 });
  });

  it('records every attempt as a self-learning outcome', async () => {
    mocks.execFile.mockResolvedValue('ok');
    const mod = await loadSelfRepair();
    await mod.attemptRepair('qa:fail', 'tests failing');

    const raw = await fs.readFile(path.join(tempDir, 'learning-outcomes.json'), 'utf-8');
    const outcomes = JSON.parse(raw) as Array<{ kind: string; agentId: string; success: boolean }>;
    expect(outcomes.some((o) => o.kind === 'repair' && o.agentId === 'repair:qa:fail' && o.success)).toBe(true);
  });
});
