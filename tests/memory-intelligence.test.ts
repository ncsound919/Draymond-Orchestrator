import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockClient, upsertCalls } = vi.hoisted(() => {
  const upsertCalls: Array<{ table: string; payload: unknown }> = [];
  const makeChain = (tables: Map<string, unknown>, table: string) => {
    const resolve = () => tables.get(table) ?? { data: null, error: null };
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      upsert: vi.fn((payload: unknown) => {
        upsertCalls.push({ table, payload });
        return chain;
      }),
      single: vi.fn(() => Promise.resolve(resolve())),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return chain;
  };
  const tables = new Map<string, unknown>();
  const client = { from: vi.fn((t: string) => makeChain(tables, t)), _tables: tables };
  return { mockClient: client, upsertCalls };
});

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondClient: vi.fn(() => mockClient),
}));
vi.mock('../src/lib/draymond/index', () => ({
  logEvent: vi.fn(async () => {}),
}));

type MemMod = typeof import('../src/lib/draymond/memory-intelligence');
let mod: MemMod;

function setTable(table: string, data: unknown, error: unknown = null) {
  mockClient._tables.set(table, { data, error });
}

function memory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    agent_id: 'agent-1',
    user_id: 'user-1',
    key: 'user-preference',
    summary: 'Prefers concise replies',
    value: { tone: 'concise' },
    importance_score: 0.8,
    decay_rate: 0.1,
    tier: 'working',
    is_active: true,
    last_accessed_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  mockClient._tables.clear();
  mod = await import('../src/lib/draymond/memory-intelligence');
});

afterEach(() => {
  mockClient._tables.clear();
  upsertCalls.length = 0;
});

describe('searchMemories', () => {
  it('returns ranked matches and excludes non-matches', async () => {
    setTable('draymond_memory', [
      memory({ id: 'mem-1', key: 'user-preference', summary: 'Prefers concise replies' }),
      memory({ id: 'mem-2', key: 'project-name', summary: 'Unrelated content' }),
    ]);
    const results = await mod.searchMemories('agent-1', 'user-1', 'prefers concise');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].memory.id).toBe('mem-1');
    expect(results[0].relevance_score).toBeGreaterThan(0);
  });

  it('throws on DB error', async () => {
    setTable('draymond_memory', null, { message: 'db down' });
    await expect(mod.searchMemories('agent-1', 'user-1', 'x')).rejects.toThrow(/db down/);
  });
});

describe('runDecaySweep', () => {
  it('decays, expires, and boosts memories', async () => {
    setTable('draymond_memory', [
      // recently accessed → boost
      memory({ id: 'm-boost', importance_score: 0.8, decay_rate: 0.1, last_accessed_at: new Date().toISOString() }),
      // stale, decays above threshold
      memory({ id: 'm-decay', importance_score: 0.5, decay_rate: 0.1, last_accessed_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() }),
      // stale, decays below threshold → expire
      memory({ id: 'm-expire', importance_score: 0.05, decay_rate: 0.1, last_accessed_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() }),
    ]);
    const result = await mod.runDecaySweep();
    expect(result.total_scanned).toBe(3);
    expect(result.decayed).toBe(1);
    expect(result.expired).toBe(1);
    expect(result.boosted).toBe(1);
  });

  it('throws when the fetch fails', async () => {
    setTable('draymond_memory', null, { message: 'boom' });
    await expect(mod.runDecaySweep()).rejects.toThrow(/boom/);
  });
});

describe('memory access', () => {
  it('grants memory access', async () => {
    setTable('draymond_memory', memory());
    setTable('draymond_memory_shares', { id: 'share-1', memory_id: 'mem-1' });
    const grant = await mod.grantMemoryAccess({
      memory_id: 'mem-1',
      owner_agent_id: 'agent-1',
      granted_agent_id: 'agent-2',
      permission: 'read',
    });
    expect(grant.id).toBe('share-1');
  });

  it('throws when the memory is not owned by the requester', async () => {
    setTable('draymond_memory', null);
    await expect(
      mod.grantMemoryAccess({ memory_id: 'mem-1', owner_agent_id: 'agent-1', granted_agent_id: 'agent-2', permission: 'read' }),
    ).rejects.toThrow(/not found or not owned/);
  });

  it('gets shared memories for an agent', async () => {
    setTable('draymond_memory', [memory({ id: 'shared-1' })]);
    const shared = await mod.getSharedMemories('agent-2', 'user-1');
    expect(Array.isArray(shared)).toBe(true);
  });

  it('revokes memory access', async () => {
    setTable('draymond_memory_shares', null);
    await expect(mod.revokeMemoryAccess('mem-1', 'agent-1', 'agent-2')).resolves.toBeUndefined();
  });

  it('computes memory insights', async () => {
    setTable('draymond_memory', [memory()]);
    const insights = await mod.getMemoryInsights('agent-1');
    expect(insights.agent_id).toBe('agent-1');
  });
});

describe('rebuildProjectionsFromBrainState', () => {
  it('indexes canonical brain-state files with provenance and tier', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-'));
    fs.writeFileSync(path.join(dir, 'system-goals.json'), JSON.stringify({ goals: [{ id: 'g1', title: 'Goal A' }] }));
    fs.writeFileSync(
      path.join(dir, 'learning-lessons.json'),
      JSON.stringify({ lessons: [{ id: 'l1', pattern: 'P1' }, { id: 'l2', pattern: 'P2' }] }),
    );
    fs.writeFileSync(path.join(dir, 'kairos.json'), JSON.stringify({ moments: [{ id: 'm1', title: 'M1' }] }));
    fs.writeFileSync(path.join(dir, 'treasury.json'), JSON.stringify({ revenueCents: 0 }));
    fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ agents: [] })); // not tiered → not indexed

    const result = await mod.rebuildProjectionsFromBrainState({
      agentId: 'draymond',
      userId: 'fleet',
      brainStateDir: dir,
    });
    expect(result.indexed).toBe(5);
    expect(result.skipped).toBe(0);

    const memoryUpserts = upsertCalls.filter((c) => c.table === 'draymond_memory');
    const sources = new Set(memoryUpserts.map((c) => (c.payload as Record<string, unknown>).source_event as string));
    expect(sources).toContain('brain_state:system-goals.json');
    expect(sources).toContain('brain_state:learning-lessons.json');
    expect(sources).toContain('brain_state:kairos.json');

    const core = memoryUpserts.find((c) => (c.payload as Record<string, unknown>).key === 'system-goals:g1');
    expect(core?.payload).toMatchObject({ tier: 'core', decay_rate: 0, importance_score: 0.9 });

    const lesson = memoryUpserts.find((c) => (c.payload as Record<string, unknown>).key === 'learning-lessons:l1');
    expect(lesson?.payload).toMatchObject({ tier: 'important', decay_rate: 0.01 });
  });

  it('returns zeros when the brain-state dir is missing', async () => {
    const result = await mod.rebuildProjectionsFromBrainState({
      brainStateDir: path.join(os.tmpdir(), 'definitely-not-a-real-dir-xyz'),
    });
    expect(result).toEqual({ indexed: 0, skipped: 0 });
  });
});

describe('checkBrainStateBudget', () => {
  it('flags files over their cap and reports sizes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-budget-'));
    fs.writeFileSync(path.join(dir, 'learning-lessons.json'), Buffer.alloc(600 * 1024, 'x')); // 600KB > 500KB cap
    fs.writeFileSync(path.join(dir, 'hypotheses.json'), JSON.stringify({ hypotheses: [] })); // tiny
    fs.writeFileSync(path.join(dir, 'unindexed-file.json'), Buffer.alloc(10 * 1024 * 1024)); // no cap → ignored

    const files = await mod.checkBrainStateBudget(dir);
    const lessons = files.find((f) => f.file === 'learning-lessons.json');
    const hypotheses = files.find((f) => f.file === 'hypotheses.json');
    expect(lessons?.overBudget).toBe(true);
    expect(lessons?.capBytes).toBe(500 * 1024);
    expect(hypotheses?.overBudget).toBe(false);
    expect(files.some((f) => f.file === 'unindexed-file.json')).toBe(false);
  });

  it('returns an empty array when the dir is missing', async () => {
    await expect(
      mod.checkBrainStateBudget(path.join(os.tmpdir(), 'definitely-not-a-real-dir-xyz')),
    ).resolves.toEqual([]);
  });
});


