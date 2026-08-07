import { describe, expect, it, vi } from 'vitest';
import {
  collectMetrics,
  buildRunId,
} from '../src/lib/draymond/benchmarking';

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
    const metrics = collectMetrics('site', rows as never, {});
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
    const metrics = collectMetrics('cron', rows as never, {});
    const failed = metrics.find((m) => m.component_slug === 'morning-briefing')!;
    expect(failed.metrics.failure_rate).toBeCloseTo(0.4);
    expect(failed.evidence).toContain('boom');
  });

  it('collects entity metrics from entity rows + event counts', () => {
    const rows = [
      { slug: 'uplift-agent', name: 'Uplift Agent', health_status: 'degraded', last_invoked_at: '2026-07-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
    ];
    const events = { 'uplift-agent': { errors: 3, invocations: 5, avg_latency_ms: 900 } };
    const metrics = collectMetrics('entity', rows as never, events);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].metrics.error_rate).toBeCloseTo(0.6);
    expect(metrics[0].metrics.avg_latency_ms).toBe(900);
  });

  it('collects chain metrics from chain rows', () => {
    const rows = [
      { slug: 'morning-briefing', name: 'Morning Briefing', total_steps: 5, failed_steps: 2, total_duration_ms: 4000 },
      { slug: 'daily-marketing-run', name: 'Daily Marketing Run', total_steps: 4, failed_steps: 0, total_duration_ms: 1000 },
    ];
    const metrics = collectMetrics('chain', rows as never, {});
    const bad = metrics.find((m) => m.component_slug === 'morning-briefing')!;
    expect(bad.metrics.failed_step_rate).toBeCloseTo(0.4);
  });

  it('getTrend returns recent weakness scores oldest-first', async () => {
    const supabase = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn(async () => ({ data: [{ weakness_score: 40 }, { weakness_score: 10 }], error: null })) })) })) })) })) })) };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { getTrend: gt } = await import('../src/lib/draymond/benchmarking');
    const trend = await gt('entity', 'uplift-agent');
    expect(trend).toEqual([10, 40]);
  });
});

describe('benchmarking recordRun', () => {
  it('inserts rows under a single run_id', async () => {
    const inserted: unknown[] = [];
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn((rows: unknown[]) => {
          inserted.push(...(rows as unknown[]));
          return { select: vi.fn(async () => ({ error: null })) };
        }),
      })),
    };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { recordRun: rr } = await import('../src/lib/draymond/benchmarking');
    const metrics = [{ component_class: 'entity' as const, component_slug: 'a', component_name: 'A', metrics: {}, evidence: '' }];
    await rr('entity', metrics, { a: 42 });
    expect(inserted).toHaveLength(1);
  });
});
