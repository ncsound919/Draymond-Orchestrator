import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient, fetchMock } = vi.hoisted(() => {
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
      limit: vi.fn(() => { op.current = 'list'; return chain; }),
      insert: vi.fn(() => { op.current = 'insert'; return chain; }),
      update: vi.fn(() => { op.current = 'update'; return chain; }),
      delete: vi.fn(() => { op.current = 'delete'; return chain; }),
      single: vi.fn(() => { op.current = 'single'; return Promise.resolve(resolve()); }),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return chain;
  };
  const tables = new Map<string, unknown>();
  const client = { from: vi.fn((t: string) => makeChain(tables, t)), _tables: tables };
  return { mockClient: client, fetchMock: vi.fn() };
});

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondAdminClient: vi.fn(() => mockClient),
}));
vi.mock('../src/lib/draymond/event-bridge', () => ({
  emitSiteDown: vi.fn(),
  emitSiteRecovered: vi.fn(),
  emitHealthCheckComplete: vi.fn(),
}));
vi.mock('../src/lib/draymond/notifications', () => ({
  sendNotification: vi.fn(async () => ({ id: 'n1' })),
}));

type MonitorsMod = typeof import('../src/lib/draymond/monitors');
let mod: MonitorsMod;

function monitor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    name: 'Site',
    url: 'https://example.com',
    expected_status_code: 200,
    timeout_ms: 5000,
    consecutive_failures: 0,
    current_status: 'unknown',
    max_failures_before_alert: 3,
    notify_on_down: false,
    notify_on_recovery: false,
    is_enabled: true,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  mockClient._tables.clear();
  mod = await import('../src/lib/draymond/monitors');
});

afterEach(() => {
  mockClient._tables.clear();
  vi.unstubAllGlobals();
});

describe('checkSite', () => {
  it('marks the site up on an expected status', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    mockClient._tables.set('draymond_site_monitors', { data: monitor(), error: null });
    const result = await mod.checkSite('m1');
    expect(result.is_up).toBe(true);
    expect(result.new_status).toBe('up');
    expect(result.status_code).toBe(200);
  });

  it('increments failures on an unexpected status', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    mockClient._tables.set('draymond_site_monitors', { data: monitor(), error: null });
    const result = await mod.checkSite('m1');
    expect(result.is_up).toBe(false);
    expect(result.consecutive_failures).toBe(1);
  });

  it('records fetch errors as a failed check', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    mockClient._tables.set('draymond_site_monitors', { data: monitor(), error: null });
    const result = await mod.checkSite('m1');
    expect(result.is_up).toBe(false);
    expect(result.error).toMatch(/network down/);
  });
});

describe('monitor CRUD', () => {
  it('listMonitors returns monitors with filters', async () => {
    mockClient._tables.set('draymond_site_monitors', { data: [monitor(), monitor({ id: 'm2' })], error: null });
    const list = await mod.listMonitors({ is_enabled: true });
    expect(list).toHaveLength(2);
  });

  it('getMonitor returns a monitor', async () => {
    mockClient._tables.set('draymond_site_monitors', { data: monitor(), error: null });
    const m = await mod.getMonitor('m1');
    expect(m?.name).toBe('Site');
  });

  it('createMonitor inserts a monitor', async () => {
    mockClient._tables.set('draymond_site_monitors', { data: monitor(), error: null });
    const m = await mod.createMonitor({ name: 'Site', url: 'https://example.com', expected_status_code: 200 });
    expect(m.id).toBe('m1');
  });

  it('deleteMonitor removes a monitor', async () => {
    mockClient._tables.set('draymond_site_monitors', null);
    await expect(mod.deleteMonitor('m1')).resolves.toBeUndefined();
  });

  it('updateMonitor updates a monitor', async () => {
    mockClient._tables.set('draymond_site_monitors', { data: monitor({ is_enabled: false }), error: null });
    const m = await mod.updateMonitor('m1', { is_enabled: false });
    expect(m.is_enabled).toBe(false);
  });

  it('getMonitorStats returns monitor statistics', async () => {
    mockClient._tables.set('draymond_site_monitors', { data: monitor({ current_status: 'up' }), error: null });
    const stats = await mod.getMonitorStats('m1');
    expect(stats.current_status).toBe('up');
  });

  it('checkAllSites checks every enabled monitor and reports a summary', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    // listMonitors (limit op) returns both; checkSite's getMonitor (single op) returns one.
    mockClient._tables.set('draymond_site_monitors', (op: string) =>
      op === 'single'
        ? { data: monitor(), error: null }
        : { data: [monitor(), monitor({ id: 'm2', current_status: 'down' })], error: null },
    );
    const summary = await mod.checkAllSites();
    expect(summary.total).toBe(2);
    expect(summary.up).toBe(2);
    expect(summary.down).toBe(0);
  });
});

describe('disableAbsentServiceMonitors (reconcile)', () => {
  it('disables absent services and re-enables present ones', async () => {
    // Env overrides are not set → presence decided by local dirs.
    delete process.env.OMNI_RESEARCH_URL;
    delete process.env.UPLIFT_BASE_URL;
    const absent = {
      id: 'm-omni',
      name: 'OmniResearch Pro',
      metadata: { slug: 'omni-research' },
      is_enabled: true,
    };
    const present = {
      id: 'm-uplift',
      name: 'Uplift Agent',
      metadata: { slug: 'uplift-agent' },
      is_enabled: false, // was disabled by an earlier boot — should be re-enabled
    };
    mockClient._tables.set('draymond_site_monitors', { data: [absent, present], error: null });
    const changed = await mod.disableAbsentServiceMonitors();
    // One disabled + one re-enabled.
    expect(changed).toBe(2);
  });
});

