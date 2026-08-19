import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockCallLLM, mockCallLocalModel, mockExecuteChain, mockAdmin, mockClient, mockLogEvent } = vi.hoisted(() => {
  const makeChain = (getResult: () => unknown) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      in: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(getResult())),
      limit: vi.fn(() => Promise.resolve(getResult())),
      // Supabase builders are thenables; make the chain awaitable so any
      // terminal method can be awaited directly.
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(getResult()).then(onF, onR),
    };
    return chain;
  };
  const adminTables = new Map<string, unknown>();
  const clientTables = new Map<string, unknown>();
  const admin = {
    from: vi.fn((t: string) => {
      const resolve = () => adminTables.get(t) ?? { data: [], error: null };
      return makeChain(resolve);
    }),
    _tables: adminTables,
  };
  const client = {
    from: vi.fn((t: string) => {
      const resolve = () => clientTables.get(t) ?? { data: [], error: null };
      return makeChain(resolve);
    }),
    _tables: clientTables,
  };
  return {
    mockCallLLM: vi.fn(),
    mockCallLocalModel: vi.fn(async (): Promise<string> => {
      throw new Error('local model not configured');
    }),
    mockExecuteChain: vi.fn(),
    mockLogEvent: vi.fn(async () => {}),
    mockAdmin: admin,
    mockClient: client,
  };
});

vi.mock('../src/lib/draymond/llm', () => ({ callLLM: mockCallLLM, callLocalModel: mockCallLocalModel }));
vi.mock('../src/lib/draymond/decomposer', () => ({
  decomposeGoalToBlueprint: vi.fn(() => null),
  decomposeGoalToIdeSteps: vi.fn(() => null),
}));
vi.mock('../src/lib/draymond/chains', () => ({ executeChain: mockExecuteChain }));
vi.mock('../src/lib/draymond/client', () => ({
  createDraymondAdminClient: vi.fn(() => mockAdmin),
  createDraymondClient: vi.fn(() => mockClient),
}));
vi.mock('../src/lib/draymond/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/draymond/index')>();
  return { ...actual, logEvent: mockLogEvent };
});

import { buildChain, buildAndExecuteChain } from '../src/lib/draymond/chain-builder';

const CATALOG = [
  {
    slug: 'email-sender',
    name: 'Email Sender',
    kind: 'agent',
    description: 'Sends email',
    capabilities: ['email'],
    category: null,
    input_schema: {},
    output_schema: {},
  },
];

function setAdmin(table: string, data: unknown, error: unknown = null) {
  mockAdmin._tables.set(table, { data, error });
}
function setClient(table: string, data: unknown, error: unknown = null) {
  mockClient._tables.set(table, { data, error });
}

function validBlueprint() {
  return JSON.stringify({
    name: 'send-email',
    description: 'Send an email',
    steps: [
      {
        name: 'step-1',
        description: 'Send',
        entity_slug: 'email-sender',
        action: 'send',
        input_mapping: { to: '$.input.to' },
        output_key: 'result',
        depends_on: [],
        risk_level: 'low',
      },
    ],
    estimated_duration_ms: 100,
    estimated_cost_cents: 1,
    confidence: 0.9,
    reasoning: 'Simple',
    warnings: [],
  });
}

afterEach(() => {
  mockAdmin._tables.clear();
  mockClient._tables.clear();
  mockCallLLM.mockReset();
  mockCallLocalModel.mockReset();
  mockExecuteChain.mockReset();
});

describe('buildChain', () => {
  it('builds a valid blueprint and auto-creates the chain', async () => {
    setAdmin('draymond_entities', CATALOG);
    mockCallLLM.mockResolvedValueOnce(validBlueprint());
    setClient('draymond_entities', [{ id: 'ent-1', slug: 'email-sender' }]);
    setClient('draymond_chains', { id: 'chain-1' });
    setClient('draymond_chain_steps', null);

    const result = await buildChain({ description: 'Send an email to bob' }, true);

    expect(result.blueprint.name).toBe('send-email');
    expect(result.blueprint.steps).toHaveLength(1);
    expect(result.validation.valid).toBe(true);
    expect(result.auto_created).toBe(true);
    expect(result.chain_id).toBe('chain-1');
  });

  it('does not create the chain unless autoCreate is true', async () => {
    setAdmin('draymond_entities', CATALOG);
    mockCallLLM.mockResolvedValueOnce(validBlueprint());

    const result = await buildChain({ description: 'Send an email to bob' }, false);
    expect(result.auto_created).toBe(false);
    expect(result.chain_id).toBeUndefined();
    expect(result.validation.valid).toBe(true);
  });

  it('accepts a valid blueprint from the local model without hitting the paid LLM', async () => {
    setAdmin('draymond_entities', CATALOG);
    mockCallLocalModel.mockResolvedValueOnce(validBlueprint());
    setClient('draymond_entities', [{ id: 'ent-1', slug: 'email-sender' }]);
    setClient('draymond_chains', { id: 'chain-1' });
    setClient('draymond_chain_steps', null);

    const result = await buildChain({ description: 'Send an email to bob' }, true);

    expect(mockCallLLM).not.toHaveBeenCalled();
    expect(mockCallLocalModel).toHaveBeenCalledTimes(1);
    expect(result.blueprint.steps).toHaveLength(1);
    expect(result.validation.valid).toBe(true);
    expect(result.auto_created).toBe(true);
  });

  it('falls back to the paid LLM when the local model returns an invalid blueprint', async () => {
    setAdmin('draymond_entities', CATALOG);
    mockCallLocalModel.mockResolvedValueOnce('not-valid-json');
    mockCallLLM.mockResolvedValueOnce(validBlueprint());
    setClient('draymond_entities', [{ id: 'ent-1', slug: 'email-sender' }]);
    setClient('draymond_chains', { id: 'chain-1' });
    setClient('draymond_chain_steps', null);

    const result = await buildChain({ description: 'Send an email to bob' }, true);

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    expect(result.blueprint.steps).toHaveLength(1);
    expect(result.validation.valid).toBe(true);
  });

  it('flags steps that reference unknown entities', async () => {
    setAdmin('draymond_entities', CATALOG);
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        name: 'bad-chain',
        description: 'x',
        steps: [
          {
            name: 's1',
            description: 'x',
            entity_slug: 'does-not-exist',
            action: 'run',
            input_mapping: {},
            output_key: 'o',
            depends_on: [],
          },
        ],
        estimated_duration_ms: 1,
        estimated_cost_cents: 1,
        confidence: 0.5,
        reasoning: 'r',
        warnings: [],
      }),
    );

    const result = await buildChain({ description: 'x' });
    expect(result.validation.valid).toBe(false);
    expect(result.validation.missing_entities.length).toBeGreaterThan(0);
    expect(result.validation.errors.some((e) => e.includes('unknown entity'))).toBe(true);
  });

  it('detects dependency cycles', async () => {
    setAdmin('draymond_entities', CATALOG);
    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify({
        name: 'cyclic',
        description: 'x',
        steps: [
          { name: 'a', description: 'x', entity_slug: 'email-sender', action: 'run', input_mapping: {}, output_key: 'o', depends_on: ['b'] },
          { name: 'b', description: 'x', entity_slug: 'email-sender', action: 'run', input_mapping: {}, output_key: 'o', depends_on: ['a'] },
        ],
        estimated_duration_ms: 1,
        estimated_cost_cents: 1,
        confidence: 0.5,
        reasoning: 'r',
        warnings: [],
      }),
    );

    const result = await buildChain({ description: 'x' });
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.some((e) => e.includes('cycle'))).toBe(true);
  });
});

describe('buildAndExecuteChain', () => {
  it('executes the created chain when valid and confident', async () => {
    setAdmin('draymond_entities', CATALOG);
    mockCallLLM.mockResolvedValueOnce(validBlueprint());
    setClient('draymond_entities', [{ id: 'ent-1', slug: 'email-sender' }]);
    setClient('draymond_chains', { id: 'chain-1' });
    setClient('draymond_chain_steps', null);
    mockExecuteChain.mockResolvedValueOnce({ steps: [] });

    const result = await buildAndExecuteChain({ description: 'Send an email' });
    expect(result.executed).toBe(true);
    expect(mockExecuteChain).toHaveBeenCalled();
  });

  it('skips execution when confidence is below the threshold', async () => {
    setAdmin('draymond_entities', CATALOG);
    const low = JSON.parse(validBlueprint());
    low.confidence = 0.4;
    mockCallLLM.mockResolvedValueOnce(JSON.stringify(low));
    setClient('draymond_entities', [{ id: 'ent-1', slug: 'email-sender' }]);
    setClient('draymond_chains', { id: 'chain-1' });
    setClient('draymond_chain_steps', null);

    const result = await buildAndExecuteChain({ description: 'Send an email' }, 0.7);
    expect(result.executed).toBe(false);
    expect(mockExecuteChain).not.toHaveBeenCalled();
  });
});
