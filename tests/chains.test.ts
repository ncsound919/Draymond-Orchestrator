import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockAdmin, mockGetEntity, mockInvokeEntity, mockLogEvent } = vi.hoisted(() => {
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
      neq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      in: vi.fn(() => chain),
      insert: vi.fn(() => { op.current = 'insert'; return chain; }),
      update: vi.fn(() => { op.current = 'update'; return chain; }),
      delete: vi.fn(() => { op.current = 'delete'; return chain; }),
      single: vi.fn(() => Promise.resolve(resolve())),
      rpc: vi.fn(() => Promise.resolve(tables.get('rpc') ?? { data: null, error: null })),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return chain;
  };
  const tables = new Map<string, unknown>();
  const admin = {
    from: vi.fn((t: string) => makeChain(tables, t)),
    rpc: vi.fn(() => Promise.resolve(tables.get('rpc') ?? { data: null, error: null })),
    _tables: tables,
  };
  return {
    mockAdmin: admin,
    mockGetEntity: vi.fn(),
    mockInvokeEntity: vi.fn(),
    mockLogEvent: vi.fn(async () => {}),
  };
});

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondAdminClient: vi.fn(() => mockAdmin),
  createDraymondClient: vi.fn(() => mockAdmin),
}));
vi.mock('../src/lib/draymond/registry', () => ({
  getEntity: mockGetEntity,
  recordInvocation: vi.fn(async () => {}),
}));
vi.mock('../src/lib/draymond/invoker', () => ({
  invokeEntity: mockInvokeEntity,
}));
vi.mock('../src/lib/draymond/index', () => ({
  logEvent: mockLogEvent,
  evaluateConfidence: vi.fn(() => ({ action: 'auto_execute' })),
  submitAction: vi.fn(async () => ({ action: { id: 'a1' } })),
  isActionApproved: vi.fn(async () => false),
}));
vi.mock('../src/lib/draymond/event-bridge', () => ({
  emitChainStarted: vi.fn(),
  emitChainStepCompleted: vi.fn(),
  emitChainStepFailed: vi.fn(),
  emitChainCompleted: vi.fn(),
  emitChainFailed: vi.fn(),
  emitAgentInvoked: vi.fn(),
  emitAgentResult: vi.fn(),
}));

import {
  createChain,
  getChain,
  listChains,
  addStep,
  addSteps,
  getChainSteps,
  instantiateChain,
  executeChain,
  detectCycles,
  detectOutputKeyCollisions,
  deleteChain,
  getChainSummary,
  canResumeChain,
  resumeChain,
} from '../src/lib/draymond/chains';
import type { DraymondChainStep } from '../src/lib/draymond/types';

function setTable(table: string, data: unknown, error: unknown = null) {
  mockAdmin._tables.set(table, { data, error });
}

function step(overrides: Partial<DraymondChainStep> = {}): DraymondChainStep {
  return {
    id: 'step-1',
    chain_id: 'chain-1',
    step_order: 1,
    name: 'Step 1',
    description: null,
    entity_id: 'ent-1',
    action: 'run',
    input_mapping: {},
    output_key: 'out',
    depends_on_steps: [],
    parallel_group: null,
    condition: null,
    confidence_threshold: null,
    risk_level: 'low',
    max_retries: 1,
    status: 'pending',
    ...overrides,
  } as DraymondChainStep;
}

function chain(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chain-1',
    name: 'Daily',
    slug: 'daily',
    description: 'x',
    version: '1.0.0',
    is_template: false,
    template_id: null,
    status: 'draft',
    trigger_type: 'manual',
    input_data: { to: 'bob' },
    context: {},
    max_retries: 1,
    total_steps: 1,
    ...overrides,
  };
}

afterEach(() => {
  mockAdmin._tables.clear();
  mockGetEntity.mockReset();
  mockInvokeEntity.mockReset();
});

describe('detectCycles', () => {
  it('returns empty for acyclic chains', () => {
    expect(detectCycles([step({ id: 'a', depends_on_steps: [] }), step({ id: 'b', depends_on_steps: ['a'] })])).toEqual([]);
  });

  it('flags circular dependencies', () => {
    const cycles = detectCycles([
      step({ id: 'a', name: 'A', depends_on_steps: ['b'] }),
      step({ id: 'b', name: 'B', depends_on_steps: ['a'] }),
    ]);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe('detectOutputKeyCollisions', () => {
  it('flags duplicate output keys in parallel steps', () => {
    const collisions = detectOutputKeyCollisions([
      step({ id: 'a', step_order: 1, output_key: 'x', name: 'A' }),
      step({ id: 'b', step_order: 1, output_key: 'x', name: 'B' }),
    ]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].key).toBe('x');
    expect(collisions[0].steps).toContain('A');
  });

  it('ignores sequential steps and unique keys', () => {
    const collisions = detectOutputKeyCollisions([
      step({ id: 'a', step_order: 1, output_key: 'x', name: 'A' }),
      step({ id: 'b', step_order: 2, output_key: 'y', name: 'B' }),
    ]);
    expect(collisions).toEqual([]);
  });
});

describe('chain CRUD', () => {
  it('createChain inserts and returns the chain', async () => {
    setTable('draymond_chains', chain());
    const result = await createChain({ name: 'Daily', slug: 'daily', description: 'x' });
    expect(result.id).toBe('chain-1');
  });

  it('createChain throws on DB error', async () => {
    setTable('draymond_chains', null, { message: 'insert failed' });
    await expect(createChain({ name: 'Daily', slug: 'daily' })).rejects.toThrow(/insert failed/);
  });

  it('getChain returns null on not-found (PGRST116)', async () => {
    setTable('draymond_chains', null, { code: 'PGRST116', message: 'no rows' });
    expect(await getChain('missing')).toBeNull();
  });

  it('getChain returns the chain when found', async () => {
    setTable('draymond_chains', chain({ name: 'Found' }));
    const c = await getChain('daily');
    expect(c?.name).toBe('Found');
  });

  it('listChains returns ordered chains', async () => {
    setTable('draymond_chains', [chain({ id: 'c1' }), chain({ id: 'c2' })]);
    const result = await listChains({ is_template: true });
    expect(result).toHaveLength(2);
  });

  it('addStep inserts a step', async () => {
    setTable('draymond_chain_steps', step());
    const s = await addStep({ chain_id: 'chain-1', step_order: 1, name: 'S', entity_id: 'e', action: 'run' });
    expect(s.id).toBe('step-1');
  });

  it('addSteps returns [] for empty input', async () => {
    expect(await addSteps([])).toEqual([]);
  });

  it('deleteChain removes the chain', async () => {
    setTable('draymond_chains', null);
    await expect(deleteChain('chain-1')).resolves.toBeUndefined();
  });
});

describe('getChainSteps / getChainSummary', () => {
  it('getChainSteps returns the steps', async () => {
    setTable('draymond_chain_steps', [step()]);
    const steps = await getChainSteps('chain-1');
    expect(steps).toHaveLength(1);
  });

  it('getChainSummary assembles chain, steps, and plan', async () => {
    setTable('draymond_chains', chain());
    setTable('draymond_chain_steps', [step()]);
    setTable('rpc', [{ step_order: 1, name: 'Step 1' }]);
    const summary = await getChainSummary('chain-1');
    expect(summary.chain.id).toBe('chain-1');
    expect(summary.steps).toHaveLength(1);
    expect(summary.plan).toHaveLength(1);
  });

  it('getChainSummary throws when the chain is missing', async () => {
    setTable('draymond_chains', null, { code: 'PGRST116' });
    await expect(getChainSummary('nope')).rejects.toThrow(/not found/);
  });
});

describe('instantiateChain', () => {
  it('instantiates a template, copies steps, and remaps dependencies', async () => {
    const tpl = chain({ id: 'tpl-1', is_template: true, max_retries: 2 });
    const instance = chain({ id: 'inst-1', is_template: false });
    mockAdmin._tables.set('draymond_chains', (op: string) =>
      op === 'insert' ? { data: instance, error: null } : { data: tpl, error: null },
    );
    mockAdmin._tables.set('draymond_chain_steps', (op: string) => {
      if (op === 'insert') {
        return { data: [step({ id: 'ns-1', depends_on_steps: [] }), step({ id: 'ns-2', depends_on_steps: [] })], error: null };
      }
      return {
        data: [
          step({ id: 'ts-1', name: 'A', depends_on_steps: [] }),
          step({ id: 'ts-2', name: 'B', depends_on_steps: ['ts-1'] }),
        ],
        error: null,
      };
    });

    const result = await instantiateChain('tpl-1', { to: 'alice' });
    expect(result.id).toBe('inst-1');
    expect(result.is_template).toBe(false);
  });

  it('throws when the template does not exist', async () => {
    setTable('draymond_chains', null, { code: 'PGRST116' });
    await expect(instantiateChain('missing', {})).rejects.toThrow(/not found/);
  });

  it('throws when the chain is not a template', async () => {
    setTable('draymond_chains', chain({ is_template: false }));
    await expect(instantiateChain('daily', {})).rejects.toThrow(/not a template/);
  });
});

describe('executeChain', () => {
  it('runs a single successful step and completes the chain', async () => {
    setTable('draymond_chains', chain({ status: 'draft' }));
    setTable('draymond_chain_steps', [step()]);
    mockGetEntity.mockResolvedValue({
      id: 'ent-1',
      slug: 'echo',
      name: 'Echo',
      kind: 'agent',
      invocation_method: 'http_api',
      invocation_config: { url: 'https://x' },
      timeout_seconds: 30,
      is_active: true,
    });
    mockInvokeEntity.mockResolvedValue({ success: true, output: { ok: 1 }, duration_ms: 5 });

    const ctx = await executeChain('chain-1');
    expect(ctx.chain_id).toBe('chain-1');
    expect(mockInvokeEntity).toHaveBeenCalled();
  });

  it('throws when the chain is not found', async () => {
    setTable('draymond_chains', null, { code: 'PGRST116' });
    await expect(executeChain('nope')).rejects.toThrow(/not found/);
  });

  it('throws when executing a template chain', async () => {
    setTable('draymond_chains', chain({ is_template: true }));
    await expect(executeChain('chain-1')).rejects.toThrow(/template/);
  });

  it('throws when the chain has no steps', async () => {
    setTable('draymond_chains', chain());
    setTable('draymond_chain_steps', []);
    await expect(executeChain('chain-1')).rejects.toThrow(/no steps/);
  });

  it('throws on dependency cycles', async () => {
    setTable('draymond_chains', chain());
    setTable('draymond_chain_steps', [
      step({ id: 'a', depends_on_steps: ['b'] }),
      step({ id: 'b', depends_on_steps: ['a'] }),
    ]);
    await expect(executeChain('chain-1')).rejects.toThrow(/cycles/);
  });

  it('marks the chain failed when a step fails', async () => {
    setTable('draymond_chains', chain());
    setTable('draymond_chain_steps', [step()]);
    mockGetEntity.mockResolvedValue({ id: 'ent-1', slug: 'echo', name: 'Echo', kind: 'agent', invocation_method: 'http_api', invocation_config: {}, timeout_seconds: 30, is_active: true });
    mockInvokeEntity.mockResolvedValue({ success: false, output: {}, error: 'boom', duration_ms: 1 });

    const ctx = await executeChain('chain-1');
    expect(ctx.steps.out?.status).toBe('failed');
  });
});

describe('canResumeChain', () => {
  it('returns not resumable when the chain is missing', async () => {
    setTable('draymond_chains', null, { code: 'PGRST116' });
    const r = await canResumeChain('nope');
    expect(r.resumable).toBe(false);
    expect(r.reason).toBe('Chain not found');
  });

  it('rejects template chains', async () => {
    setTable('draymond_chains', chain({ is_template: true }));
    const r = await canResumeChain('chain-1');
    expect(r.resumable).toBe(false);
  });

  it('rejects chains whose status is not failed or paused', async () => {
    setTable('draymond_chains', chain({ status: 'completed' }));
    const r = await canResumeChain('chain-1');
    expect(r.resumable).toBe(false);
  });

  it('reports resumable for failed chains with steps', async () => {
    setTable('draymond_chains', chain({ status: 'failed' }));
    setTable('draymond_chain_steps', [step({ status: 'completed' }), step({ id: 'step-2', status: 'failed' })]);
    const r = await canResumeChain('chain-1');
    expect(r.resumable).toBe(true);
    expect(r.completedSteps).toBe(1);
    expect(r.totalSteps).toBe(2);
  });
});

describe('resumeChain', () => {
  it('throws for a non-resumable status', async () => {
    setTable('draymond_chains', chain({ status: 'completed' }));
    await expect(resumeChain('chain-1')).rejects.toThrow(/only "failed" or "paused"/);
  });

  it('resumes a failed chain and re-runs failed steps', async () => {
    setTable('draymond_chains', chain({ status: 'failed' }));
    setTable('draymond_chain_steps', [
      step({ id: 'step-1', status: 'completed', output_key: 'done' }),
      step({ id: 'step-2', status: 'failed', output_key: 'out' }),
    ]);
    mockGetEntity.mockResolvedValue({
      id: 'ent-1', slug: 'echo', name: 'Echo', kind: 'agent', invocation_method: 'http_api', invocation_config: {}, timeout_seconds: 30, is_active: true,
    });
    mockInvokeEntity.mockResolvedValue({ success: true, output: { ok: 1 }, duration_ms: 5 });

    const ctx = await resumeChain('chain-1');
    expect(ctx.chain_id).toBe('chain-1');
    expect(mockInvokeEntity).toHaveBeenCalled();
  });
});
