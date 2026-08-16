import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const originalEnv = { ...process.env };

let tempDir = '';

const mocks = vi.hoisted(() => ({
  publishIssueNotification: vi.fn(async () => true),
}));

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'draymond-learning-repair-'));
  process.env.DRAYMOND_REGISTRY_DIR = tempDir;
  // Cheap loop detection for tests: 2 applied repairs within the window.
  process.env.DRAYMOND_REPAIR_LOOP_THRESHOLD = '2';
  mocks.publishIssueNotification.mockClear();
});

afterEach(async () => {
  process.env = { ...originalEnv };
  vi.resetModules();
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

async function load() {
  vi.resetModules();
  vi.doMock('../src/lib/draymond/ntfy', () => ({ publishIssueNotification: mocks.publishIssueNotification }));
  return await import('../src/lib/draymond/learning-repair');
}

function lessonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ls_x',
    agentId: 'scheduler:marketing-pulse',
    pattern: 'scheduler job failed: marketing-pulse',
    lesson: 'Repeated failure: "scheduler job failed: marketing-pulse" (3/3). missing job_config.chain_slug',
    evidenceCount: 3,
    lastSeen: new Date().toISOString(),
    ...overrides,
  };
}

describe('repairHintsFor', () => {
  it('derives actionable hints from repeated-failure lessons', async () => {
    await fs.writeFile(path.join(tempDir, 'learning-lessons.json'), JSON.stringify({ lessons: [lessonRow()] }), 'utf-8');

    const mod = await load();
    const hints = await mod.repairHintsFor('scheduler:marketing-pulse');

    expect(hints).toHaveLength(1);
    expect(hints[0].component).toBe('scheduler:marketing-pulse');
    expect(hints[0].signal).toBe('job:error');
    expect(hints[0].kind).toBe('chain_config');
    expect(hints[0].evidenceCount).toBe(3);
    expect(hints[0].recommendation.length).toBeGreaterThan(0);
  });

  it('ignores lessons that are not repeated failures', async () => {
    await fs.writeFile(
      path.join(tempDir, 'learning-lessons.json'),
      JSON.stringify({ lessons: [lessonRow({ lesson: 'Repeated pattern: "x" (2x).' })] }),
      'utf-8',
    );

    const mod = await load();
    expect(await mod.repairHintsFor('scheduler:marketing-pulse')).toEqual([]);
  });

  it('returns no hints when no lessons exist', async () => {
    const mod = await load();
    expect(await mod.repairHintsFor('scheduler:x')).toEqual([]);
  });
});

describe('lessonSignal', () => {
  it('routes scheduler components to job:error', async () => {
    const mod = await load();
    expect(mod.lessonSignal('scheduler:daily-report', 'Repeated failure')).toBe('job:error');
  });

  it('routes monitor components to monitor:down', async () => {
    const mod = await load();
    expect(mod.lessonSignal('monitor:overlay-site', 'Repeated failure')).toBe('monitor:down');
  });
});

describe('escalateRepairLoops', () => {
  it('publishes an alert + incident outcome for a detected loop', async () => {
    const now = Date.now();
    const entries = [0, 1].map((i) => ({
      id: `rp_${i}`,
      detectedAt: new Date(now - i * 60_000).toISOString(),
      signal: 'monitor:down',
      action: { name: 'restart:service', service: 'overlay', command: [] as string[], safe: false },
      status: 'applied' as const,
      detail: `attempt ${i}`,
    }));
    await fs.writeFile(path.join(tempDir, 'repair-log.json'), JSON.stringify(entries), 'utf-8');

    const mod = await load();
    const loops = await mod.escalateRepairLoops();

    expect(loops).toHaveLength(1);
    expect(loops[0].signal).toBe('monitor:down');
    expect(mocks.publishIssueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('monitor:down'), priority: 5 }),
    );

    // The incident is recorded back into learning → closes the loop.
    const raw = await fs.readFile(path.join(tempDir, 'learning-store.json'), 'utf-8');
    const store = JSON.parse(raw) as { outcomes: Array<{ kind: string; agentId: string; success: boolean }> };
    expect(store.outcomes.some((o) => o.kind === 'incident' && o.agentId === 'repair-loop:monitor:down' && !o.success)).toBe(true);
  });

  it('returns an empty list when no loops exist', async () => {
    const mod = await load();
    expect(await mod.escalateRepairLoops()).toEqual([]);
    expect(mocks.publishIssueNotification).not.toHaveBeenCalled();
  });
});
