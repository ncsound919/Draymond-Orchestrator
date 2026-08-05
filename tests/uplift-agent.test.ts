import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient } = vi.hoisted(() => {
  const makeChain = (tables: Map<string, unknown>, table: string) => {
    const op = { current: 'select' as string };
    const resolve = () => {
      const entry = tables.get(table);
      if (typeof entry === 'function') return (entry as (o: string) => unknown)(op.current);
      return entry ?? { data: null, error: null };
    };
    const chain = {
      select: vi.fn(() => {
        if (op.current !== 'insert') op.current = 'select';
        return chain;
      }),
      eq: vi.fn(() => chain),
      insert: vi.fn(() => { op.current = 'insert'; return chain; }),
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

type UpliftMod = typeof import('../src/lib/draymond/uplift-agent');
let mod: UpliftMod;

beforeEach(async () => {
  vi.resetModules(); // clears the module-level agent cache
  mockClient._tables.clear();
  mod = await import('../src/lib/draymond/uplift-agent');
});

afterEach(() => {
  mockClient._tables.clear();
});

describe('ensureUpliftGuideAgent', () => {
  it('creates and caches the agent on first call', async () => {
    mockClient._tables.set('draymond_agents', (op: string) =>
      op === 'insert' ? { data: { id: 'agent-1' }, error: null } : { data: null, error: null },
    );
    const id = await mod.ensureUpliftGuideAgent();
    expect(id).toBe('agent-1');

    const id2 = await mod.ensureUpliftGuideAgent();
    expect(id2).toBe('agent-1');
  });

  it('returns the existing agent id when already registered', async () => {
    mockClient._tables.set('draymond_agents', { data: { id: 'existing-1' }, error: null });
    const id = await mod.ensureUpliftGuideAgent();
    expect(id).toBe('existing-1');
  });

  it('throws when registration fails with a non-race error', async () => {
    mockClient._tables.set('draymond_agents', { data: null, error: { code: '500', message: 'db down' } });
    await expect(mod.ensureUpliftGuideAgent()).rejects.toThrow(/db down/);
  });
});

describe('getUpliftGuideAgent', () => {
  it('returns the agent record', async () => {
    mockClient._tables.set('draymond_agents', { data: { id: 'agent-1', name: 'Uplift Guide' }, error: null });
    const agent = await mod.getUpliftGuideAgent();
    expect(agent?.name).toBe('Uplift Guide');
  });
});
