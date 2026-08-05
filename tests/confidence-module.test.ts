import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockDb } = vi.hoisted(() => {
  const tables = new Map<string, { data: unknown; error: unknown }>();
  const makeChain = (table: string) => {
    const resolve = () => tables.get(table) ?? { data: null, error: null };
    return {
      select: vi.fn(() => makeChain(table)),
      eq: vi.fn(() => makeChain(table)),
      order: vi.fn(() => makeChain(table)),
      limit: vi.fn(() => Promise.resolve(resolve())),
      single: vi.fn(() => Promise.resolve(resolve())),
      insert: vi.fn(() => Promise.resolve(resolve())),
    };
  };
  return {
    mockDb: {
      from: vi.fn((table: string) => makeChain(table)),
      tables,
    },
  };
});

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondClient: vi.fn(() => mockDb),
}));

import {
  logExecution,
  getEntityPerformance,
  computeConfidence,
  getAllEntityPerformance,
} from '../src/lib/draymond/confidence';

/** Store raw `data`; the chainable mock wraps it as { data, error }. */
function setTable(table: string, data: unknown, error: unknown = null) {
  mockDb.tables.set(table, { data, error });
}

afterEach(() => {
  mockDb.tables.clear();
});

describe('logExecution', () => {
  it('inserts an execution log and does not throw on success', async () => {
    setTable('draymond_execution_logs', null);
    await expect(
      logExecution({ entity_id: 'e1', entity_slug: 'sl', action: 'run', success: true, duration_ms: 10 }),
    ).resolves.toBeUndefined();
  });

  it('logs and swallows insert errors', async () => {
    setTable('draymond_execution_logs', null, { message: 'boom' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await logExecution({ entity_id: 'e1', entity_slug: 'sl', action: 'run', success: false, duration_ms: 1 });
      expect(err).toHaveBeenCalledWith(expect.stringContaining('Failed to log execution'));
    } finally {
      err.mockRestore();
    }
  });
});

describe('getEntityPerformance', () => {
  it('computes percentiles, streak, and success rate from logs', async () => {
    setTable('draymond_execution_logs', [
      { success: true, duration_ms: 100, created_at: 't1' },
      { success: true, duration_ms: 200, created_at: 't2' },
      { success: false, duration_ms: 300, created_at: 't3' },
    ]);
    const perf = await getEntityPerformance('e1', 'sl');
    expect(perf.total_executions).toBe(3);
    expect(perf.successful_executions).toBe(2);
    expect(perf.failed_executions).toBe(1);
    expect(perf.success_rate).toBeCloseTo(2 / 3);
    expect(perf.avg_duration_ms).toBe(200);
    expect(perf.current_streak).toBe(2); // newest two logs are successes
    expect(perf.streak_type).toBe('success');
  });

  it('returns zeros for an empty history', async () => {
    setTable('draymond_execution_logs', []);
    const perf = await getEntityPerformance('e1', 'sl');
    expect(perf.total_executions).toBe(0);
    expect(perf.success_rate).toBe(0);
    expect(perf.p50_duration_ms).toBe(0);
  });
});

describe('computeConfidence', () => {
  it('combines all signals and clamps to [0,1]', async () => {
    setTable('draymond_execution_logs', Array.from({ length: 10 }, () => ({ success: true, duration_ms: 50, created_at: 't' })));
    setTable('draymond_entities', { health_status: 'healthy', linked_agent_id: null });

    const result = await computeConfidence('e1', 'sl', {
      step_index: 1,
      total_steps: 3,
      previous_step_succeeded: true,
      chain_failure_count: 0,
    });

    expect(result.final_score).toBeGreaterThan(0);
    expect(result.final_score).toBeLessThanOrEqual(1);
    expect(result.signals).toHaveLength(4);
    const sources = result.signals.map((s) => s.source);
    expect(sources).toContain('historical_rate');
    expect(sources).toContain('entity_health');
    expect(sources).toContain('recent_trend');
    expect(sources).toContain('chain_context');
    expect(result.recent_executions).toBe(10);
  });

  it('uses baseline for entities with sparse history', async () => {
    setTable('draymond_execution_logs', [{ success: true, duration_ms: 5, created_at: 't' }]);
    setTable('draymond_entities', { health_status: 'offline', linked_agent_id: null });
    const result = await computeConfidence('e1', 'sl');
    expect(result.historical_success_rate).toBeNull();
    expect(result.final_score).toBeLessThan(0.8);
  });
});

describe('getAllEntityPerformance', () => {
  it('fetches and maps performance for all entities', async () => {
    setTable('draymond_entities', [
      { id: 'a', slug: 'x' },
      { id: 'b', slug: 'y' },
    ]);
    setTable('draymond_execution_logs', []);

    const all = await getAllEntityPerformance();
    expect(Array.isArray(all)).toBe(true);
  });
});
