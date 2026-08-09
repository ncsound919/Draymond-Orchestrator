import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-ultraplan-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

vi.mock('../src/lib/draymond/cognition', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/draymond/cognition')>();
  return {
    ...mod,
    hasNativeReasoning: vi.fn(() => false),
    callDeepLLM: vi.fn(),
    deepenLoop: vi.fn(),
  };
});
vi.mock('../src/lib/draymond/index', () => ({ storeMemory: vi.fn(async () => {}) }));

import {
  enqueueUltraplan,
  getUltraplan,
  listUltraplans,
  processUltraplan,
  processNextUltraplan,
  approveUltraplan,
  rejectUltraplan,
  replanUltraplan,
  recoverStuckUltraplans,
} from '../src/lib/draymond/ultraplan';
import { hasNativeReasoning, callDeepLLM, deepenLoop } from '../src/lib/draymond/cognition';
import { storeMemory } from '../src/lib/draymond/index';

const mockHasNativeReasoning = vi.mocked(hasNativeReasoning);
const mockCallDeepLLM = vi.mocked(callDeepLLM);
const mockDeepenLoop = vi.mocked(deepenLoop);
const mockStoreMemory = vi.mocked(storeMemory);

const ARTIFACT = {
  goals: ['g1'], phases: ['p1'], steps: ['s1'],
  changes: [{ file: 'src/x.ts', description: 'change', line: '12' }],
  dependencies: [], risks: ['r1'], verification: ['npm test'], tokenEstimate: 500,
};

beforeEach(() => {
  // afterEach tears the tmp dir down — restore the registry dir + a clean
  // state file so every test starts from default state.
  process.env.DRAYMOND_REGISTRY_DIR = tmp;
  fs.mkdirSync(tmp, { recursive: true });
  fs.rmSync(path.join(tmp, 'ultraplan.json'), { force: true });
  mockHasNativeReasoning.mockReturnValue(false);
  mockCallDeepLLM.mockClear();
  mockDeepenLoop.mockClear();
  mockStoreMemory.mockClear();
  delete process.env.ULTRAPLAN_MAX_QUEUE;
  delete process.env.ULTRAPLAN_STUCK_MS;
});

afterEach(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('ultraplan queue + state machine', () => {
  it('enqueues a plan as queued and lists/gets it', async () => {
    const plan = await enqueueUltraplan({ title: 'Add billing', brief: 'Add stripe billing' });
    expect(plan.status).toBe('queued');
    expect(plan.id).toMatch(/^up_/);
    expect((await getUltraplan(plan.id))?.task.title).toBe('Add billing');
    expect(await listUltraplans()).toHaveLength(1);
    expect(await listUltraplans({ status: 'queued' })).toHaveLength(1);
    expect(await listUltraplans({ status: 'approved' })).toHaveLength(0);
  });

  it('rejects enqueue when the queue is full', async () => {
    process.env.ULTRAPLAN_MAX_QUEUE = '2';
    await enqueueUltraplan({ title: 'a', brief: 'a' });
    await enqueueUltraplan({ title: 'b', brief: 'b' });
    await expect(enqueueUltraplan({ title: 'c', brief: 'c' })).rejects.toThrow(/queue full/);
  });

  it('processes via the deepen loop and lands plan_ready with the artifact', async () => {
    const plan = await enqueueUltraplan({ title: 'Refactor', brief: 'Refactor the scheduler' });
    mockDeepenLoop.mockResolvedValueOnce(ARTIFACT);
    const done = await processUltraplan(plan.id);
    expect(done.status).toBe('plan_ready');
    expect(done.plan).toEqual(ARTIFACT);
    expect(mockDeepenLoop).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.stringContaining('deep-planning') }),
      expect.any(Number),
    );
  });

  it('uses the native reasoning lane when a reasoning provider is configured', async () => {
    const plan = await enqueueUltraplan({ title: 'Native', brief: 'Native pass' });
    mockHasNativeReasoning.mockReturnValue(true);
    mockCallDeepLLM.mockResolvedValueOnce('```json\n' + JSON.stringify(ARTIFACT) + '\n```');
    const done = await processUltraplan(plan.id);
    expect(done.status).toBe('plan_ready');
    expect(done.plan).toEqual(ARTIFACT);
    expect(mockCallDeepLLM).toHaveBeenCalled();
  });

  it('marks a plan failed when the deep lane throws', async () => {
    const plan = await enqueueUltraplan({ title: 'Doomed', brief: 'x' });
    mockDeepenLoop.mockRejectedValueOnce(new Error('provider down'));
    const done = await processUltraplan(plan.id);
    expect(done.status).toBe('failed');
    expect(done.error).toContain('provider down');
  });

  it('approve requires plan_ready, stores a memory, and offers run-as-chain', async () => {
    const plan = await enqueueUltraplan({ title: 'Approve me', brief: 'x' });
    mockDeepenLoop.mockResolvedValueOnce(ARTIFACT);
    await processUltraplan(plan.id);
    const approved = await approveUltraplan(plan.id);
    expect(approved.status).toBe('approved');
    expect(approved.runAsChainAvailable).toBe(true);
    const mem = mockStoreMemory.mock.calls.find((c) => c[0].key === `ultraplan:${plan.id}`)![0];
    expect(mem.source_event).toBe('ultraplan_approved');
    expect(mem.tier).toBe('important');
  });

  it('approve/reject/replan follow the state machine', async () => {
    const plan = await enqueueUltraplan({ title: 'Machine', brief: 'x' });
    mockDeepenLoop.mockResolvedValueOnce(ARTIFACT);
    await processUltraplan(plan.id);
    await expect(approveUltraplan(plan.id)).resolves.toMatchObject({ status: 'approved' });

    const plan2 = await enqueueUltraplan({ title: 'Reject me', brief: 'x' });
    mockDeepenLoop.mockResolvedValueOnce(ARTIFACT);
    await processUltraplan(plan2.id);
    await rejectUltraplan(plan2.id);
    const replanned = await replanUltraplan(plan2.id, 'edited brief');
    expect(replanned.status).toBe('queued');
    expect(replanned.task.brief).toBe('edited brief');
    expect(replanned.plan).toBeUndefined();
    await expect(replanUltraplan(plan.id, 'nope')).rejects.toThrow(); // approved → not replannable
  });

  it('recoverStuckUltraplans fails planning jobs older than the stuck window', async () => {
    process.env.ULTRAPLAN_STUCK_MS = '300000';
    const plan = await enqueueUltraplan({ title: 'Stuck', brief: 'x' });
    // Force it into a stale planning state.
    const f = path.join(tmp, 'ultraplan.json');
    const state = JSON.parse(fs.readFileSync(f, 'utf-8'));
    const stuck = state.plans.find((p: { id: string }) => p.id === plan.id);
    stuck.status = 'planning';
    stuck.updatedAt = new Date(Date.now() - 3_600_000).toISOString();
    fs.writeFileSync(f, JSON.stringify(state));
    const r = await recoverStuckUltraplans();
    expect(r.recovered).toBe(1);
    expect((await getUltraplan(plan.id))?.status).toBe('failed');
  });

  it('processNextUltraplan drains the oldest queued plan (fail-soft)', async () => {
    const r = await processNextUltraplan();
    expect(r).toEqual({ processed: 0 });
    const plan = await enqueueUltraplan({ title: 'Drain', brief: 'x' });
    mockDeepenLoop.mockResolvedValueOnce(ARTIFACT);
    const r2 = await processNextUltraplan();
    expect(r2.processed).toBe(1);
    expect(r2.id).toBe(plan.id);
    expect(r2.status).toBe('plan_ready');
  });
});
