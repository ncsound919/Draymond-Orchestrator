import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient } = vi.hoisted(() => {
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
      upsert: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(resolve())),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return chain;
  };
  const tables = new Map<string, unknown>();
  const client = { from: vi.fn((t: string) => makeChain(tables, t)), _tables: tables };
  return { mockClient: client };
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


