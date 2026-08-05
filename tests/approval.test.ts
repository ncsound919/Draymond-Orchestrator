import { beforeEach, describe, expect, it, vi } from 'vitest';

type ActionRow = {
  id: string;
  status: string;
  agent_id?: string;
  action_type?: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  executed_at?: string | null;
  [key: string]: unknown;
};

type StepRow = {
  id: string;
  chain_id?: string;
  [key: string]: unknown;
};

type UpdateRecord = { table: string; patch: Record<string, unknown> };
type InsertRecord = { table: string; row: Record<string, unknown> };

// In-memory action store simulating draymond_actions rows.
const actions = vi.hoisted(() => new Map<string, ActionRow>());
const chainSteps = vi.hoisted(() => new Map<string, StepRow>());
const updateCalls = vi.hoisted(() => [] as UpdateRecord[]);
const insertCalls = vi.hoisted(() => [] as InsertRecord[]);

type MockChain = {
  eqs: Record<string, string>;
  pendingPatch: Record<string, unknown> | null;
  select: () => MockChain;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  single: () => Promise<{ data: unknown; error: { message: string } | null }>;
  order: () => MockChain;
  update: (patch: Record<string, unknown>) => MockChain;
  insert: (row: Record<string, unknown>) => MockChain;
  eq: (col: string, value: string) => MockChain;
};

function mockQuery(table: string): { from: (_: string) => MockChain } {
  return { from: (t: string) => buildChain(t === '' ? table : t) };
}

function buildChain(table: string): MockChain {
  const chain: MockChain = {
    eqs: {},
    pendingPatch: null,
    select: () => chain,
    maybeSingle: async () => {
      const id = chain.eqs['id'];
      const row =
        table === 'draymond_actions'
          ? actions.get(id)
          : table === 'draymond_chain_steps'
            ? chainSteps.get(id)
            : undefined;
      return { data: row ?? null, error: null };
    },
    single: async () => {
      const id = chain.eqs['id'];
      let row = table === 'draymond_actions' ? actions.get(id) : undefined;
      if (row && chain.eqs['status'] && row.status !== chain.eqs['status']) {
        row = undefined; // .eq('status', ...) filter does not match
      }
      if (row && chain.pendingPatch) {
        row = { ...row, ...chain.pendingPatch };
        actions.set(id, row);
        chain.pendingPatch = null;
      }
      return { data: row ?? null, error: row ? null : { message: 'not found' } };
    },
    order: () => chain,
    update: (patch: Record<string, unknown>) => {
      updateCalls.push({ table, patch });
      chain.pendingPatch = patch;
      return chain;
    },
    insert: (row: Record<string, unknown>) => {
      insertCalls.push({ table, row });
      return chain;
    },
    eq: (col: string, value: string) => {
      chain.eqs[col] = value;
      return chain;
    },
  };
  return chain;
}

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondClient: vi.fn(() => mockQuery('')),
  createDraymondAdminClient: vi.fn(() => mockQuery('')),
}));

// reviewAction logs an event via logEvent — no-op it.
vi.mock('../src/lib/draymond/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/draymond/index')>();
  return { ...actual, logEvent: vi.fn(async () => {}) };
});

import { isActionApproved, reviewAction } from '../src/lib/draymond/index';

describe('isActionApproved', () => {
  beforeEach(() => {
    actions.clear();
    updateCalls.length = 0;
    insertCalls.length = 0;
  });

  it('returns false for a null id', async () => {
    expect(await isActionApproved(null)).toBe(false);
  });

  it('returns true when the action status is approved', async () => {
    actions.set('act-1', { id: 'act-1', status: 'approved' });
    expect(await isActionApproved('act-1')).toBe(true);
  });

  it('returns false when pending review', async () => {
    actions.set('act-1', { id: 'act-1', status: 'pending_review' });
    expect(await isActionApproved('act-1')).toBe(false);
  });

  it('returns false when the action does not exist', async () => {
    expect(await isActionApproved('missing')).toBe(false);
  });
});

describe('reviewAction', () => {
  beforeEach(() => {
    actions.clear();
    chainSteps.clear();
    updateCalls.length = 0;
    insertCalls.length = 0;
  });

  it('rejects a pending action (no resume triggered)', async () => {
    actions.set('act-1', {
      id: 'act-1',
      agent_id: 'agent-1',
      action_type: 'chain_step:execute',
      status: 'pending_review',
    });
    const reviewed = (await reviewAction('act-1', 'admin', false, 'not now')) as ActionRow;
    expect(reviewed.status).toBe('rejected');
    expect(reviewed.reviewed_by).toBe('admin');
    expect(reviewed.review_notes).toBe('not now');
  });

  it('throws when the action is not pending_review', async () => {
    actions.set('act-1', { id: 'act-1', status: 'approved' });
    await expect(reviewAction('act-1', 'admin', true)).rejects.toThrow(/Failed to review/);
  });

  it('approves a standalone action and records execution', async () => {
    actions.set('act-1', {
      id: 'act-1',
      agent_id: 'agent-1',
      action_type: 'send_email',
      status: 'pending_review',
    });
    const reviewed = (await reviewAction('act-1', 'admin', true)) as ActionRow;
    expect(reviewed.status).toBe('approved');
    // The post-approval execution path (after()) falls back to a detached
    // promise in a non-request context; give it a tick.
    await new Promise((r) => setTimeout(r, 10));
    const execUpdate = updateCalls.find(
      (c) => c.table === 'draymond_actions' && c.patch.executed_at,
    );
    expect(execUpdate).toBeDefined();
  });
});
