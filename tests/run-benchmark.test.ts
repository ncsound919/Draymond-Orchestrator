import { describe, expect, it, vi } from 'vitest';

describe('runBenchmarkCycle', () => {
  it('returns a summary without throwing when sources are empty', async () => {
    // Fluent thenable builder matching the proven upgrade-queue mock pattern:
    // `select(...)` / `gte(...)` chain to a builder that resolves to an empty
    // result set, which is what runBenchmarkCycle hits for an empty run.
    const supabase = {
      from: vi.fn(() => {
        const builder = {
          select: vi.fn(() => builder),
          gte: vi.fn(() => builder),
          then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
        };
        return builder;
      }),
    };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { runBenchmarkCycle: cycle } = await import('../src/lib/draymond/run-benchmark');
    const result = await cycle('entity');
    expect(result.componentClass).toBe('entity');
    expect(typeof result.recorded).toBe('number');
    expect(Array.isArray(result.weakest)).toBe(true);
  });

  it('keys entity event stats by slug via linked_agent_id and excludes unmapped agents', async () => {
    const entityRows = [
      { slug: 'uplift-agent', name: 'Uplift Agent', linked_agent_id: 'agent-uuid-1', health_status: 'healthy', last_invoked_at: null },
    ];
    const eventRows = [
      { agent_id: 'agent-uuid-1', severity: 'error' },
      { agent_id: 'agent-uuid-1', severity: 'info' },
      { agent_id: 'unmapped-agent', severity: 'error' },
    ];
    const insertCalls: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'draymond_entities') {
          return {
            select: vi.fn(async () => ({ data: entityRows, error: null })),
          };
        }
        if (table === 'draymond_events') {
          return {
            select: vi.fn(() => ({
              gte: vi.fn(async () => ({ data: eventRows, error: null })),
            })),
          };
        }
        if (table === 'draymond_benchmarks') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(async () => ({ data: [], error: null })),
                  })),
                })),
              })),
            })),
            insert: vi.fn((rows: Array<Record<string, unknown>>) => {
              insertCalls.push({ table, rows });
              return { select: vi.fn(async () => ({ error: null })) };
            }),
          };
        }
        // draymond_upgrade_queue
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                })),
              })),
            })),
          })),
          insert: vi.fn((row: Record<string, unknown>) => {
            insertCalls.push({ table, rows: [row] });
            return { error: null };
          }),
        };
      }),
    };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { runBenchmarkCycle: cycle } = await import('../src/lib/draymond/run-benchmark');

    const result = await cycle('entity');
    expect(result.measured).toBe(1);
    expect(result.recorded).toBe(1);

    const benchmarkInsert = insertCalls.find((c) => c.table === 'draymond_benchmarks')!;
    expect(benchmarkInsert).toBeDefined();
    expect(benchmarkInsert.rows).toHaveLength(1);
    expect(benchmarkInsert.rows[0].component_slug).toBe('uplift-agent');
    // 1 error / 2 events for the linked agent; the unmapped agent's error is excluded.
    expect(benchmarkInsert.rows[0].metrics).toMatchObject({
      error_rate: 0.5,
      errors: 1,
      invocations: 2,
    });
  });
});
