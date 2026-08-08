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
  const updateCalls: Array<{ table: string; payload: Record<string, unknown>; filters: string[] }> = [];
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
          update: vi.fn((payload: Record<string, unknown>) => {
            const filters: string[] = [];
            const rec = {
              eq: (col: string, val: unknown) => {
                filters.push(`${col}=${val}`);
                return rec;
              },
              then: async (resolve: (value: unknown) => void) => resolve({ error: null }),
            };
            updateCalls.push({ table, payload, filters });
            return rec;
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
  return { supabase, insertCalls, updateCalls };
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

  it('deep-scores the weakest entity, counts it as a success, and persists deep scores', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.stubEnv('REPORANK_API_KEY', 'gr_rr');
    vi.stubEnv('REPORANK_POLL_INTERVAL_MS', '1');
    vi.stubEnv('GRADER_URL', 'http://localhost:5000');
    vi.stubEnv('GRADER_API_KEY', 'gr_gr');
    vi.stubEnv('VIBE_REALITY_URL', 'http://localhost:6000');
    vi.stubEnv('VIBE_REALITY_ID_TOKEN', 'tok');
    vi.stubEnv('VIBE_POLL_INTERVAL_MS', '1');

    // RepoRank: submit scan → poll complete. Grader: /api/grade. Vibe: submit + poll.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/api/v1/scans') && method === 'POST') {
        return new Response(JSON.stringify({ data: { scanId: 's1', status: 'queued' } }), { status: 201 });
      }
      if (url.includes('/api/v1/scans/') && method === 'GET') {
        return new Response(JSON.stringify({ data: { status: 'complete', result: { overallScore: 90, gradeCategory: 'A' } } }), { status: 200 });
      }
      if (url.includes('/api/grade')) {
        return new Response(JSON.stringify({ overallScore: 88, gradeCategory: 'A' }), { status: 200 });
      }
      if (url.includes('/api/analyze')) {
        return new Response(JSON.stringify({ jobId: 'j1' }), { status: 200 });
      }
      if (url.includes('/api/jobs/')) {
        return new Response(JSON.stringify({ status: 'complete', result: { realityScore: 75 } }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const { supabase, updateCalls } = buildEntitySupabase({
      entityRows: [
        { slug: 'uplift-agent', name: 'Uplift Agent', linked_agent_id: 'agent-uuid-1', health_status: 'healthy', last_invoked_at: null, source_url: 'https://github.com/uplift/uplift' },
      ],
      eventRows: [{ agent_id: 'agent-uuid-1', severity: 'error' }],
    });
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { runBenchmarkCycle: cycle } = await import('../src/lib/draymond/run-benchmark');

    const result = await cycle('entity', { deepScoreLimit: 1 });
    expect(result.deepScored).toBe(1);
    expect(result.queued).toBe(1);

    // Deep scores must be persisted onto the benchmark row for the run.
    const deepUpdate = updateCalls.find(
      (u) => u.table === 'draymond_benchmarks' && u.payload.deep_scores
    );
    expect(deepUpdate).toBeDefined();
    expect(deepUpdate!.payload.deep_scores).toMatchObject({
      reporank: { scorer: 'reporank', score: 90 },
      grader: { scorer: 'grader', score: 88 },
    });
    expect(deepUpdate!.filters.some((f) => f.startsWith('run_id=entity-'))).toBe(true);
    expect(deepUpdate!.filters).toContain('component_class=entity');
    expect(deepUpdate!.filters).toContain('component_slug=uplift-agent');
  });

  it('counts deepScored as zero when every scorer errors', async () => {
    vi.stubEnv('REPORANK_URL', 'http://localhost:4000');
    vi.stubEnv('REPORANK_API_KEY', 'gr_rr');
    vi.stubEnv('GRADER_URL', 'http://localhost:5000');
    vi.stubEnv('GRADER_API_KEY', 'gr_gr');
    vi.stubEnv('VIBE_REALITY_URL', 'http://localhost:6000');
    vi.stubEnv('VIBE_REALITY_ID_TOKEN', 'tok');
    globalThis.fetch = vi.fn(async () => new Response('oops', { status: 500 }));

    const { supabase } = buildEntitySupabase({
      entityRows: [
        { slug: 'uplift-agent', name: 'Uplift Agent', linked_agent_id: 'agent-uuid-1', health_status: 'healthy', last_invoked_at: null, source_url: 'https://github.com/uplift/uplift' },
      ],
      eventRows: [],
    });
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { runBenchmarkCycle: cycle } = await import('../src/lib/draymond/run-benchmark');

    const result = await cycle('entity', { deepScoreLimit: 1 });
    expect(result.deepScored).toBe(0);
    // This entity is healthy (score 0 — no error events, healthy status), so the
    // score-0 gate keeps it out of the upgrade queue.
    expect(result.queued).toBe(0);
  });
});
