import { describe, expect, it, vi, afterEach } from 'vitest';

// Fluent per-table supabase mock covering the entity benchmark path:
//   from('draymond_entities').select('*').limit(...)
//   from('draymond_events').select(...).gte(...)
//   from('draymond_benchmarks').select('weakness_score').eq().eq().order().limit(...)  (trend)
//   from('draymond_benchmarks').insert(...).select(...)                                 (recordRun)
//   from('draymond_upgrade_queue').select('id').eq().eq().eq().maybeSingle() + insert   (queueWeakest)
function buildEntitySupabase(options: {
  entityRows: Array<Record<string, unknown>>;
  eventRows?: Array<Record<string, unknown>>;
  trendRows?: Array<{ weakness_score: number }>;
}) {
  const insertCalls: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'draymond_entities') {
        return {
          select: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: options.entityRows, error: null })),
          })),
        };
      }
      if (table === 'draymond_events') {
        return {
          select: vi.fn(() => ({
            gte: vi.fn(async () => ({ data: options.eventRows ?? [], error: null })),
          })),
        };
      }
      if (table === 'draymond_benchmarks') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: options.trendRows ?? [], error: null })),
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
  return { supabase, insertCalls };
}

describe('runBenchmarkCycle', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('returns a summary without throwing when sources are empty', async () => {
    // Fluent thenable builder matching the proven upgrade-queue mock pattern:
    // `select(...)` / `gte(...)` chain to a builder that resolves to an empty
    // result set, which is what runBenchmarkCycle hits for an empty run.
    const supabase = {
      from: vi.fn(() => {
        const builder = {
          select: vi.fn(() => builder),
          gte: vi.fn(() => builder),
          limit: vi.fn(() => builder),
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
    const { supabase, insertCalls } = buildEntitySupabase({
      entityRows: [
        { slug: 'uplift-agent', name: 'Uplift Agent', linked_agent_id: 'agent-uuid-1', health_status: 'healthy', last_invoked_at: null },
      ],
      eventRows: [
        { agent_id: 'agent-uuid-1', severity: 'error' },
        { agent_id: 'agent-uuid-1', severity: 'info' },
        { agent_id: 'unmapped-agent', severity: 'error' },
      ],
    });
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

  it('deep-scores the weakest entity and counts it as a success', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.stubEnv('GRADER_URL', 'http://localhost:5000');
    vi.stubEnv('VIBE_REALITY_URL', 'http://localhost:6000');
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ trust: 90, summary: 'ok' }), { status: 200 })
    );

    const { supabase } = buildEntitySupabase({
      entityRows: [
        { slug: 'uplift-agent', name: 'Uplift Agent', linked_agent_id: 'agent-uuid-1', health_status: 'healthy', last_invoked_at: null },
      ],
      eventRows: [{ agent_id: 'agent-uuid-1', severity: 'error' }],
    });
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { runBenchmarkCycle: cycle } = await import('../src/lib/draymond/run-benchmark');

    const result = await cycle('entity', { deepScoreLimit: 1 });
    expect(result.deepScored).toBe(1);
    expect(result.queued).toBe(1);
  });

  it('counts deepScored as zero when every scorer errors', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.stubEnv('GRADER_URL', 'http://localhost:5000');
    vi.stubEnv('VIBE_REALITY_URL', 'http://localhost:6000');
    globalThis.fetch = vi.fn(async () => new Response('oops', { status: 500 }));

    const { supabase } = buildEntitySupabase({
      entityRows: [
        { slug: 'uplift-agent', name: 'Uplift Agent', linked_agent_id: 'agent-uuid-1', health_status: 'healthy', last_invoked_at: null },
      ],
      eventRows: [],
    });
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { runBenchmarkCycle: cycle } = await import('../src/lib/draymond/run-benchmark');

    const result = await cycle('entity', { deepScoreLimit: 1 });
    expect(result.deepScored).toBe(0);
    expect(result.queued).toBe(1);
  });
});
