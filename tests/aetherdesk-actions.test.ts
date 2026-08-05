import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAdmin, fetchMock, mockPublishResult } = vi.hoisted(() => {
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
      update: vi.fn(() => { op.current = 'update'; return chain; }),
      single: vi.fn(() => Promise.resolve(resolve())),
      maybeSingle: vi.fn(() => Promise.resolve(resolve())),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return chain;
  };
  const tables = new Map<string, unknown>();
  return {
    mockAdmin: { from: vi.fn((t: string) => makeChain(tables, t)), _tables: tables },
    fetchMock: vi.fn(),
    mockPublishResult: vi.fn(async () => true),
  };
});

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondAdminClient: vi.fn(() => mockAdmin),
}));
vi.mock('../src/lib/draymond/ntfy', () => ({
  publishResultNotification: mockPublishResult,
}));

type AetherMod = typeof import('../src/lib/draymond/aetherdesk');
let mod: AetherMod;

const originalEnv = { ...process.env };

/** Stores the raw row; the chainable mock wraps it as { data, error }. */
function setTable(table: string, data: unknown, error: unknown = null) {
  mockAdmin._tables.set(table, { data, error });
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  mockAdmin._tables.clear();
  mockPublishResult.mockClear();
  process.env.AETHERDESK_BASE_URL = 'http://127.0.0.1:8000/api/v1';
  process.env.AETHERDESK_API_KEY = 'test-key';
  mod = await import('../src/lib/draymond/aetherdesk');
});

afterEach(() => {
  for (const k of ['AETHERDESK_BASE_URL', 'AETHERDESK_API_KEY']) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  vi.unstubAllGlobals();
});

describe('resolveAetherDeskAgentId', () => {
  it('returns the agent id when found', async () => {
    setTable('draymond_agents', { id: 'agent-9' });
    const id = await mod.resolveAetherDeskAgentId();
    expect(id).toBe('agent-9');
  });

  it('returns null when not found', async () => {
    setTable('draymond_agents', null);
    expect(await mod.resolveAetherDeskAgentId()).toBeNull();
  });
});

describe('executeApprovedAetherDeskAction', () => {
  it('does nothing when the action is missing', async () => {
    setTable('draymond_actions', null);
    await mod.executeApprovedAetherDeskAction('act-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips actions that are not approved', async () => {
    setTable('draymond_actions', { id: 'act-1', status: 'pending' });
    await mod.executeApprovedAetherDeskAction('act-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips actions that were already executed', async () => {
    setTable('draymond_actions', { id: 'act-1', status: 'approved', executed_at: '2026-01-01' });
    await mod.executeApprovedAetherDeskAction('act-1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('executes an approved action and records completion', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    setTable('draymond_actions', {
      id: 'act-1',
      status: 'approved',
      executed_at: null,
      payload: { aetherdesk_operation: 'health', aetherdesk_input: {}, tenant_id: 'TENANT-001' },
    });
    await mod.executeApprovedAetherDeskAction('act-1');
    expect(fetchMock).toHaveBeenCalled();
    expect(mockPublishResult).toHaveBeenCalled();
  });

  it('records failure when the AetherDesk call fails', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    setTable('draymond_actions', {
      id: 'act-1',
      status: 'approved',
      executed_at: null,
      payload: { aetherdesk_operation: 'health', aetherdesk_input: {}, tenant_id: 'TENANT-001' },
    });
    await mod.executeApprovedAetherDeskAction('act-1');
    expect(mockPublishResult).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
