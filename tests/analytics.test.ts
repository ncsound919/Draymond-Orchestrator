import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockClient } = vi.hoisted(() => {
  const makeChain = (tables: Map<string, unknown>, table: string) => {
    const resolve = () => tables.get(table) ?? { data: null, error: null };
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      range: vi.fn(() => chain),
      insert: vi.fn(() => chain),
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

import {
  trackCost,
  getCostSummary,
  getEntityLeaderboard,
  getExecutionHeatmap,
  getLatencyPercentiles,
  getAnalyticsSummary,
  getRecentExecutions,
} from '../src/lib/draymond/analytics';

function setTable(table: string, data: unknown, error: unknown = null) {
  mockClient._tables.set(table, { data, error });
}

afterEach(() => {
  mockClient._tables.clear();
  vi.restoreAllMocks();
});

describe('trackCost', () => {
  it('inserts a cost record', async () => {
    setTable('draymond_cost_records', null);
    await expect(trackCost({ entity_id: 'e1', cost_type: 'llm_tokens', amount_cents: 5 })).resolves.toBeUndefined();
  });

  it('logs and swallows insert errors', async () => {
    setTable('draymond_cost_records', null, { message: 'boom' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await trackCost({ entity_id: 'e1', cost_type: 'llm_tokens', amount_cents: 5 });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('getCostSummary', () => {
  it('aggregates cost by type and entity', async () => {
    setTable('draymond_cost_records', [
      { entity_id: 'e1', cost_type: 'llm_tokens', amount_cents: 100 },
      { entity_id: 'e2', cost_type: 'llm_tokens', amount_cents: 50 },
      { entity_id: 'e1', cost_type: 'api', amount_cents: 25 },
    ]);
    const summary = await getCostSummary('2026-01-01');
    expect(summary.total_cents).toBe(175);
    expect(summary.by_type.llm_tokens).toBe(150);
    expect(summary.by_type.api).toBe(25);
    expect(summary.by_entity.e1).toBe(125);
  });
});

describe('getEntityLeaderboard', () => {
  it('returns an empty leaderboard when there are no logs', async () => {
    setTable('draymond_execution_logs', []);
    expect(await getEntityLeaderboard('2026-01-01')).toEqual([]);
  });

  it('computes ranked entries from logs', async () => {
    setTable('draymond_execution_logs', [
      { entity_id: 'e1', entity_slug: 'riggs', success: true, duration_ms: 100, cost_cents: 10 },
      { entity_id: 'e1', entity_slug: 'riggs', success: true, duration_ms: 200, cost_cents: 10 },
      { entity_id: 'e2', entity_slug: 'moss', success: false, duration_ms: 300, cost_cents: 50 },
    ]);
    setTable('draymond_entities', [
      { id: 'e1', slug: 'riggs', name: 'Riggs', kind: 'agent' },
      { id: 'e2', slug: 'moss', name: 'Moss', kind: 'agent' },
    ]);
    const entries = await getEntityLeaderboard('2026-01-01');
    expect(entries).toHaveLength(2);
    expect(entries[0].rank).toBe(1);
    expect(entries[0].entity_slug).toBe('riggs');
    expect(entries[0].success_rate).toBe(1);
  });
});

describe('getExecutionHeatmap', () => {
  it('returns a full 7x24 grid', async () => {
    setTable('draymond_execution_logs', [
      { success: true, duration_ms: 100, created_at: '2026-01-05T12:30:00Z' },
      { success: false, duration_ms: 50, created_at: '2026-01-05T12:40:00Z' },
    ]);
    const points = await getExecutionHeatmap('2026-01-01');
    expect(points).toHaveLength(7 * 24);
    const noon = points.find((p) => p.day_of_week === 1 && p.hour === 12); // 2026-01-05 is a Monday
    expect(noon).toBeDefined();
    expect(noon!.execution_count).toBe(2);
  });
});

describe('getLatencyPercentiles', () => {
  it('computes percentiles from durations', async () => {
    setTable('draymond_execution_logs', [
      { duration_ms: 100 },
      { duration_ms: 200 },
      { duration_ms: 300 },
    ]);
    const p = await getLatencyPercentiles('2026-01-01');
    expect(p.sample_count).toBe(3);
    expect(p.avg_ms).toBe(200);
    expect(p.min_ms).toBe(100);
    expect(p.max_ms).toBe(300);
    expect(p.p50_ms).toBeGreaterThan(0);
  });

  it('returns zeros for an empty sample', async () => {
    setTable('draymond_execution_logs', []);
    const p = await getLatencyPercentiles('2026-01-01');
    expect(p.sample_count).toBe(0);
    expect(p.p50_ms).toBe(0);
  });
});

describe('getAnalyticsSummary', () => {
  it('composes a full summary', async () => {
    setTable('draymond_execution_logs', []);
    setTable('draymond_cost_records', []);
    setTable('draymond_entities', []);
    setTable('draymond_chains', []);
    const summary = await getAnalyticsSummary('day');
    expect(summary.period).toBe('day');
    expect(summary.total_executions).toBe(0);
    expect(Array.isArray(summary.heatmap)).toBe(true);
  });
});

describe('getRecentExecutions', () => {
  it('returns recent logs with filters', async () => {
    setTable('draymond_execution_logs', [{ id: 'l1', entity_id: 'e1' }]);
    const logs = await getRecentExecutions({ entity_id: 'e1', success: true });
    expect(logs).toHaveLength(1);
    expect(logs[0].entity_id).toBe('e1');
  });

  it('throws on DB error', async () => {
    setTable('draymond_execution_logs', null, { message: 'query failed' });
    await expect(getRecentExecutions()).rejects.toThrow(/query failed/);
  });
});

