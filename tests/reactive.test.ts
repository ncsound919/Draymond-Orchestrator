import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient, mockInvokeEntity, mockInstantiateChain, mockExecuteChain, mockGetEntity } = vi.hoisted(() => {
  const makeChain = (tables: Map<string, unknown>, table: string) => {
    const op = { current: 'select' as string };
    const resolve = () => {
      const entry = tables.get(table);
      if (typeof entry === 'function') return (entry as (o: string) => unknown)(op.current);
      return entry ?? { data: null, error: null };
    };
    const chain = {
      select: vi.fn(() => {
        if (op.current !== 'insert' && op.current !== 'update' && op.current !== 'delete') op.current = 'select';
        return chain;
      }),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      insert: vi.fn(() => { op.current = 'insert'; return chain; }),
      update: vi.fn(() => { op.current = 'update'; return chain; }),
      delete: vi.fn(() => { op.current = 'delete'; return chain; }),
      single: vi.fn(() => Promise.resolve(resolve())),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return chain;
  };
  const tables = new Map<string, unknown>();
  return {
    mockClient: { from: vi.fn((t: string) => makeChain(tables, t)), _tables: tables },
    mockInvokeEntity: vi.fn(),
    mockInstantiateChain: vi.fn(),
    mockExecuteChain: vi.fn(),
    mockGetEntity: vi.fn(),
  };
});

vi.mock('../src/lib/draymond/client', () => ({ createDraymondClient: vi.fn(() => mockClient) }));
vi.mock('../src/lib/draymond/index', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/lib/draymond/invoker', () => ({ invokeEntity: mockInvokeEntity }));
vi.mock('../src/lib/draymond/chains', () => ({ instantiateChain: mockInstantiateChain, executeChain: mockExecuteChain }));
vi.mock('../src/lib/draymond/registry', () => ({ getEntity: mockGetEntity }));

type ReactiveMod = typeof import('../src/lib/draymond/reactive');
let mod: ReactiveMod;

function setTable(table: string, data: unknown, error: unknown = null) {
  mockClient._tables.set(table, { data, error });
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    name: 'Notify on chain done',
    description: 'x',
    pattern: { event_type: 'chain.completed', conditions: { chain_id: 'c1' } },
    action_type: 'invoke_entity',
    action_config: { entity_slug: 'email-sender', input_mapping: { to: 'email' } },
    is_active: true,
    trigger_count: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules(); // clears the subscription cache
  mockClient._tables.clear();
  mod = await import('../src/lib/draymond/reactive');
});

afterEach(() => {
  mockClient._tables.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('subscription CRUD', () => {
  it('creates a subscription', async () => {
    setTable('draymond_event_subscriptions', { id: 'sub-1', name: 'S' });
    const sub = await mod.createSubscription({
      name: 'S',
      description: 'x',
      pattern: { event_type: 'chain.completed' },
      action_type: 'emit_event',
      action_config: { event_type: 'chain.failed' },
    });
    expect(sub.id).toBe('sub-1');
  });

  it('lists subscriptions (active only)', async () => {
    setTable('draymond_event_subscriptions', [subscription()]);
    const subs = await mod.listSubscriptions(true);
    expect(subs).toHaveLength(1);
  });

  it('toggles a subscription', async () => {
    setTable('draymond_event_subscriptions', null);
    await expect(mod.toggleSubscription('sub-1', false)).resolves.toBeUndefined();
  });

  it('deletes a subscription', async () => {
    setTable('draymond_event_subscriptions', null);
    await expect(mod.deleteSubscription('sub-1')).resolves.toBeUndefined();
  });
});

describe('processEvent', () => {
  it('returns zero counts when nothing matches', async () => {
    setTable('draymond_event_subscriptions', [subscription()]);
    const result = await mod.processEvent('chain.failed', 'test', { chain_id: 'c2' });
    expect(result).toEqual({ matched: 0, triggered: 0, errors: [] });
  });

  it('matches a subscription and invokes the configured entity', async () => {
    setTable('draymond_event_subscriptions', [subscription()]);
    mockGetEntity.mockResolvedValue({
      id: 'ent-1',
      slug: 'email-sender',
      name: 'Email',
      kind: 'agent',
      invocation_method: 'http_api',
      invocation_config: {},
      timeout_seconds: 30,
    });
    mockInvokeEntity.mockResolvedValue({ success: true, output: {}, duration_ms: 5 });

    const result = await mod.processEvent('chain.completed', 'test', { chain_id: 'c1', email: 'a@b.c' });
    expect(result.matched).toBe(1);
    expect(result.triggered).toBe(1);
    expect(mockInvokeEntity).toHaveBeenCalled();
  });

  it('records errors when an action throws', async () => {
    setTable('draymond_event_subscriptions', [subscription({ action_config: {} })]);
    const result = await mod.processEvent('chain.completed', 'test', { chain_id: 'c1' });
    expect(result.matched).toBe(1);
    expect(result.errors.length).toBe(1);
  });

  it('executes a chain action', async () => {
    setTable('draymond_event_subscriptions', [
      subscription({ action_type: 'execute_chain', action_config: { chain_slug: 'daily' } }),
    ]);
    mockInstantiateChain.mockResolvedValue({ id: 'inst-1' });
    mockExecuteChain.mockResolvedValue({});
    const result = await mod.processEvent('chain.completed', 'test', { chain_id: 'c1' });
    expect(result.triggered).toBe(1);
    expect(mockInstantiateChain).toHaveBeenCalledWith('daily', expect.anything());
  });

  it('blocks non-allowlisted localhost webhooks in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOCAL_SERVICE_ALLOWLIST', '');
    setTable('draymond_event_subscriptions', [
      subscription({ action_type: 'webhook', action_config: { webhook_url: 'https://localhost:9000/hook' } }),
    ]);
    const result = await mod.processEvent('chain.completed', 'test', { chain_id: 'c1' });
    expect(result.matched).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/private or internal/);
  });

  it('allows an allowlisted localhost webhook in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOCAL_SERVICE_ALLOWLIST', 'localhost');
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    setTable('draymond_event_subscriptions', [
      subscription({ action_type: 'webhook', action_config: { webhook_url: 'http://localhost:9000/hook' } }),
    ]);
    const result = await mod.processEvent('chain.completed', 'test', { chain_id: 'c1' });
    expect(result.errors.length).toBe(0);
    expect(result.triggered).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('onBridgeEvent', () => {
  it('delegates to processEvent without throwing', async () => {
    setTable('draymond_event_subscriptions', []);
    await expect(mod.onBridgeEvent('chain.completed', {})).resolves.toBeUndefined();
  });
});
