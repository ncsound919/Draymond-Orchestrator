import { describe, expect, it, vi } from 'vitest';
import {
  collectMetrics,
  buildRunId,
} from '../src/lib/draymond/benchmarking';
import type { BenchmarkMetric } from '../src/lib/draymond/types';

describe('benchmarking collection', () => {
  it('builds a run id from class + timestamp', () => {
    const id = buildRunId('entity');
    expect(id).toMatch(/^entity-[\d-]+$/);
  });

  it('collects site metrics from monitor rows', () => {
    const rows = [
      { name: 'Uplift Agent', url: 'http://x/health', current_status: 'up', last_response_time_ms: 120, consecutive_failures: 0, metadata: { slug: 'uplift-agent' } },
      { name: 'Sports Steve', url: 'http://y/health', current_status: 'down', last_response_time_ms: null, consecutive_failures: 4, metadata: { slug: 'sports-steve' } },
    ];
    const metrics = collectMetrics('site', rows, {});
    expect(metrics).toHaveLength(2);
    const down = metrics.find((m) => m.component_slug === 'sports-steve')!;
    expect(down.metrics.failures).toBe(4);
    expect(down.metrics.status).toBe('down');
    expect(down.metrics.uptime_pct).toBe(0);
  });

  it('collects cron metrics from job rows', () => {
    const rows = [
      { name: 'Morning Briefing', last_run_status: 'failed', run_count: 10, fail_count: 4, last_run_duration_ms: 5000, last_error: 'boom' },
      { name: 'Site Health Checks', last_run_status: 'success', run_count: 20, fail_count: 1, last_run_duration_ms: 800, last_error: null },
    ];
    const metrics = collectMetrics('cron', rows, {});
    const failed = metrics.find((m) => m.component_slug === 'morning-briefing')!;
    expect(failed.metrics.failure_rate).toBeCloseTo(0.4);
    expect(failed.evidence).toContain('boom');
  });

  it('treats a cron job with zero runs as a 0 failure rate (no div-by-zero)', () => {
    const rows = [
      { name: 'Never Run', last_run_status: null, run_count: 0, fail_count: 0, last_run_duration_ms: null, last_error: null },
    ];
    const metrics = collectMetrics('cron', rows, {});
    expect(metrics).toHaveLength(1);
    expect(metrics[0].metrics.run_count).toBe(0);
    expect(metrics[0].metrics.failure_rate).toBe(0);
  });

  it('collects entity metrics from entity rows + event counts', () => {
    const rows = [
      { slug: 'uplift-agent', name: 'Uplift Agent', health_status: 'degraded', last_invoked_at: '2026-07-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
    ];
    const events = { 'uplift-agent': { errors: 3, invocations: 5, avg_latency_ms: 900 } };
    const metrics = collectMetrics('entity', rows, events);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].metrics.error_rate).toBeCloseTo(0.6);
    expect(metrics[0].metrics.avg_latency_ms).toBe(900);
  });

  it('collects chain metrics from chain rows', () => {
    const rows = [
      { slug: 'morning-briefing', name: 'Morning Briefing', total_steps: 5, failed_steps: 2, total_duration_ms: 4000 },
      { slug: 'daily-marketing-run', name: 'Daily Marketing Run', total_steps: 4, failed_steps: 0, total_duration_ms: 1000 },
    ];
    const metrics = collectMetrics('chain', rows, {});
    const bad = metrics.find((m) => m.component_slug === 'morning-briefing')!;
    expect(bad.metrics.failed_step_rate).toBeCloseTo(0.4);
  });

  it('throws on an unknown component class', () => {
    expect(() => collectMetrics('bogus' as never, [], {})).toThrow('Unknown component class: bogus');
  });
});

describe('benchmarking trend', () => {
  function mockTrendClient(data: Array<{ weakness_score: number }>) {
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(async () => ({ data, error: null })),
              })),
            })),
          })),
        })),
      })),
    };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    return import('../src/lib/draymond/benchmarking');
  }

  it('returns recent weakness scores oldest-first', async () => {
    const { getTrend: gt } = await mockTrendClient([{ weakness_score: 40 }, { weakness_score: 10 }]);
    const trend = await gt('entity', 'uplift-agent');
    expect(trend).toEqual([10, 40]);
  });

  it('returns [] when there is no trend data', async () => {
    const { getTrend: gt } = await mockTrendClient([]);
    const trend = await gt('entity', 'nothing');
    expect(trend).toEqual([]);
  });
});

describe('benchmarking recordRun', () => {
  it('inserts the expected row content under a single run_id and selects it', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const selectMock = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn((rows: Array<Record<string, unknown>>) => {
          inserted.push(...rows);
          return { select: selectMock };
        }),
      })),
    };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { recordRun: rr } = await import('../src/lib/draymond/benchmarking');

    const metrics: BenchmarkMetric[] = [
      { component_class: 'entity', component_slug: 'a', component_name: 'A', metrics: { errors: 2, invocations: 5 }, evidence: 'hit' },
      { component_class: 'entity', component_slug: 'b', component_name: 'B', metrics: { errors: 1, invocations: 1 }, evidence: 'miss' },
    ];
    const result = await rr('entity', metrics, { a: 42, b: 7 });

    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({
      run_id: expect.stringMatching(/^entity-[\d-]+$/),
      component_class: 'entity',
      component_slug: 'a',
      component_name: 'A',
      weakness_score: 42,
      evidence: 'hit',
    });
    expect(inserted[0].metrics).toEqual({ errors: 2, invocations: 5 });
    expect(inserted[1].weakness_score).toBe(7);
    expect(inserted[1].run_id).toBe(inserted[0].run_id);
    expect(selectMock).toHaveBeenCalled();
    expect(result).toEqual({ run_id: inserted[0].run_id, recorded: 2 });
  });

  it('returns recorded 0 without creating a client when metrics are empty', async () => {
    vi.doMock('../src/lib/draymond/client', () => ({
      createDraymondAdminClient: () => {
        throw new Error('client should not be created for an empty run');
      },
    }));
    vi.resetModules();
    const { recordRun: rr } = await import('../src/lib/draymond/benchmarking');
    await expect(rr('entity', [])).resolves.toEqual({ run_id: expect.stringMatching(/^entity-[\d-]+$/), recorded: 0 });
  });
});

describe('benchmarking recordDeepScores', () => {
  it('updates deep scores for each scored component under the run', async () => {
    const updates: Array<{ payload: unknown; runId: string; cls: string; slug: string }> = [];
    const supabase = {
      from: vi.fn(() => {
        const chain = {
          update: vi.fn((payload: unknown) => ({
            eq: vi.fn((col1: string, v1: unknown) => ({
              eq: vi.fn((col2: string, v2: unknown) => ({
                eq: vi.fn((col3: string, v3: unknown) => {
                  updates.push({ payload, runId: String(v1), cls: String(v2), slug: String(v3) });
                  return { error: null };
                }),
              })),
            })),
          })),
        };
        return chain;
      }),
    };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { recordDeepScores } = await import('../src/lib/draymond/benchmarking');

    const deep = {
      'uplift-agent': { reporank: { scorer: 'reporank', score: 90, summary: 'ok' } },
      megacode: { grader: { scorer: 'grader', score: 80, summary: 'ok' } },
    };
    const count = await recordDeepScores('entity-20260807', 'entity', deep);
    expect(count).toBe(2);
    expect(updates).toHaveLength(2);
    expect(updates[0].runId).toBe('entity-20260807');
    expect(updates[0].cls).toBe('entity');
    expect(updates[0].payload).toEqual({ deep_scores: deep['uplift-agent'] });
  });

  it('returns 0 and never touches the client when there are no deep scores', async () => {
    vi.doMock('../src/lib/draymond/client', () => ({
      createDraymondAdminClient: () => { throw new Error('client should not be created'); },
    }));
    vi.resetModules();
    const { recordDeepScores } = await import('../src/lib/draymond/benchmarking');
    await expect(recordDeepScores('entity-20260807', 'entity', {})).resolves.toBe(0);
  });
});
