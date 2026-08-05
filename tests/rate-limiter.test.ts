import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkRateLimit,
  recordCost,
  getCostSummary,
  checkBudget,
  withRateLimitAndCost,
} from '../src/lib/draymond/rate-limiter';

const { mockLogEvent, mockClient, mockInvokeEntity } = vi.hoisted(() => ({
  mockLogEvent: vi.fn(async () => {}),
  mockClient: { from: vi.fn() },
  mockInvokeEntity: vi.fn(),
}));

vi.mock('../src/lib/draymond/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/draymond/index')>();
  return { ...actual, logEvent: mockLogEvent };
});

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondClient: vi.fn(() => mockClient),
}));

vi.mock('../src/lib/draymond/invoker', () => ({
  invokeEntity: (...args: unknown[]) => mockInvokeEntity(...args),
}));

import { logEvent } from '../src/lib/draymond/index';

function stubCostEvents(data: unknown) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data, error: null })),
  };
  mockClient.from.mockReturnValue(chain);
}

describe('checkRateLimit (token bucket)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to the limit', () => {
    vi.useFakeTimers();
    expect(checkRateLimit('ent-1', 2, 60_000).allowed).toBe(true);
    expect(checkRateLimit('ent-1', 2, 60_000).allowed).toBe(true);
    expect(checkRateLimit('ent-1', 2, 60_000).allowed).toBe(false);
  });

  it('reports remaining count', () => {
    vi.useFakeTimers();
    expect(checkRateLimit('ent-r', 3, 60_000).remaining).toBe(2);
    expect(checkRateLimit('ent-r', 3, 60_000).remaining).toBe(1);
    expect(checkRateLimit('ent-r', 3, 60_000).remaining).toBe(0);
  });

  it('resets after the window elapses', () => {
    vi.useFakeTimers();
    checkRateLimit('ent-2', 1, 60_000);
    expect(checkRateLimit('ent-2', 1, 60_000).allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit('ent-2', 1, 60_000).allowed).toBe(true);
  });

  it('returns resetAt based on the oldest request', () => {
    vi.useFakeTimers();
    const before = Date.now();
    checkRateLimit('ent-3', 1, 60_000);
    const reset = checkRateLimit('ent-3', 1, 60_000).resetAt.getTime();
    expect(reset).toBeGreaterThanOrEqual(before + 60_000);
  });

  it('rejects invalid inputs', () => {
    expect(checkRateLimit('', 5, 1000).allowed).toBe(false);
    expect(checkRateLimit('ent-4', 0, 1000).allowed).toBe(false);
    expect(checkRateLimit('ent-4', -1, 1000).allowed).toBe(false);
    expect(checkRateLimit('ent-4', 5, 0).allowed).toBe(false);
    expect(checkRateLimit('ent-4', Number.NaN, 1000).allowed).toBe(false);
    expect(checkRateLimit('ent-4', 5, Number.POSITIVE_INFINITY).allowed).toBe(false);
  });
});

describe('recordCost', () => {
  it('throws on invalid cost values', async () => {
    await expect(recordCost('e1', 'a1', -1)).rejects.toThrow(/Invalid costCents/);
    await expect(recordCost('e1', 'a1', Number.NaN)).rejects.toThrow(/Invalid costCents/);
  });

  it('logs a cost_recorded event with entity metadata', async () => {
    mockLogEvent.mockClear();
    await recordCost('e1', 'agent-1', 42, { model: 'x' });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'agent-1',
        event_type: 'cost_recorded',
        metadata: expect.objectContaining({ entity_id: 'e1', cost_cents: 42, model: 'x' }),
      }),
    );
  });

  it('falls back to entityId as agent_id', async () => {
    mockLogEvent.mockClear();
    await recordCost('e1', undefined, 5);
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ agent_id: 'e1' }));
  });
});

describe('getCostSummary / checkBudget', () => {
  it('aggregates costs filtered by entity', async () => {
    stubCostEvents([
      { metadata: { entity_id: 'e1', cost_cents: 100 } },
      { metadata: { entity_id: 'e2', cost_cents: 50 } },
      { metadata: { entity_id: 'e1', cost_cents: 25 } },
      { metadata: null },
    ]);
    const summary = await getCostSummary('e1');
    expect(summary.totalCents).toBe(125);
    expect(summary.count).toBe(2);
    expect(summary.avgCents).toBe(62.5);
  });

  it('returns zero summary when no matching events', async () => {
    stubCostEvents([]);
    const summary = await getCostSummary('nope');
    expect(summary).toEqual({ totalCents: 0, count: 0, avgCents: 0 });
  });

  it('checkBudget blocks when spending equals the budget', async () => {
    stubCostEvents([{ metadata: { entity_id: 'e1', cost_cents: 100 } }]);
    const budget = await checkBudget('e1', 100, 24);
    expect(budget.allowed).toBe(false);
    expect(budget.spentCents).toBe(100);
    expect(budget.remainingCents).toBe(0);
  });

  it('checkBudget allows under-budget spending', async () => {
    stubCostEvents([{ metadata: { entity_id: 'e1', cost_cents: 40 } }]);
    const budget = await checkBudget('e1', 100, 24);
    expect(budget.allowed).toBe(true);
    expect(budget.remainingCents).toBe(60);
  });
});

describe('withRateLimitAndCost', () => {
  const baseEntity = {
    id: 'ent-x',
    name: 'X',
    slug: 'x',
    kind: 'agent',
    invocation_method: 'http_api',
    invocation_config: {},
    timeout_seconds: 30,
  };

  it('delegates to invokeEntity when no limits configured', async () => {
    mockInvokeEntity.mockResolvedValueOnce({ success: true, output: { ok: true }, duration_ms: 10 });
    const result = await withRateLimitAndCost(baseEntity, 'do', {});
    expect(result.success).toBe(true);
    expect(mockInvokeEntity).toHaveBeenCalled();
  });

  it('blocks when the rate limit is exhausted', async () => {
    mockInvokeEntity.mockClear();
    mockInvokeEntity.mockResolvedValue({ success: true, output: { ok: true }, duration_ms: 1 });
    const entity = {
      ...baseEntity,
      id: 'rl-block',
      invocation_config: { rate_limit: { max_requests: 1, window_ms: 60_000 } },
    };
    await withRateLimitAndCost(entity, 'do', {});
    const result = await withRateLimitAndCost(entity, 'do', {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Rate limited/);
    expect(mockInvokeEntity).toHaveBeenCalledTimes(1);
  });

  it('blocks when over budget', async () => {
    stubCostEvents([{ metadata: { entity_id: 'budget-block', cost_cents: 500 } }]);
    const entity = {
      ...baseEntity,
      id: 'budget-block',
      invocation_config: { budget: { max_cents: 100, window_hours: 24 } },
    };
    const result = await withRateLimitAndCost(entity, 'do', {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Budget exceeded/);
  });

  it('records cost after a successful invocation', async () => {
    mockLogEvent.mockClear();
    mockInvokeEntity.mockResolvedValueOnce({ success: true, output: { ok: true }, duration_ms: 5 });
    const entity = {
      ...baseEntity,
      id: 'cost-record',
      invocation_config: { cost_per_call_cents: 7, agent_id: 'agent-7' },
    };
    const result = await withRateLimitAndCost(entity, 'do', {});
    expect(result.success).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ agent_id: 'agent-7' }));
  });
});
