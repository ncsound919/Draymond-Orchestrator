import { describe, expect, it } from 'vitest';
import { scoreMetrics, classifyTrend, buildWeaknessScores } from '../src/lib/draymond/weakness-scoring';
import type { BenchmarkMetric } from '../src/lib/draymond/types';

function metric(overrides: Partial<BenchmarkMetric> = {}): BenchmarkMetric {
  return {
    component_class: 'site',
    component_slug: 'shop',
    component_name: 'Shop',
    metrics: { status: 'up', failures: 0, latency_ms: 120, uptime_pct: 100 },
    evidence: '',
    ...overrides,
  };
}

describe('weakness scoring', () => {
  it('scores a healthy site low', () => {
    const m = metric();
    const { score, reasons } = scoreMetrics('site', m);
    expect(score).toBeLessThan(20);
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('scores a down site exactly with the corrected weights', () => {
    // statusPenalty 100, failPenalty min(6/3,1)*60 = 60, latencyPen 0 (null),
    // uptimePen 0.1*(100-0) = 10 → 0.4*100 + 0.3*60 + 0.2*0 + 10 = 68
    const m = metric({
      metrics: { status: 'down', failures: 6, latency_ms: null, uptime_pct: 0 },
    });
    const { score, reasons } = scoreMetrics('site', m);
    expect(score).toBe(68);
    expect(reasons).toContain('down status');
    expect(reasons).toContain('6 consecutive failures');
  });

  it('scores a failing cron higher than a healthy one', () => {
    const bad = scoreMetrics('cron', metric({
      component_class: 'cron',
      metrics: { failure_rate: 0.8, duration_ms: 5000, last_run_status: 'failed' },
    }));
    const good = scoreMetrics('cron', metric({
      component_class: 'cron',
      metrics: { failure_rate: 0.0, duration_ms: 500, last_run_status: 'success' },
    }));
    expect(bad.score).toBeGreaterThan(good.score);
  });

  it('scores a failing cron exactly with honest failure-rate weight', () => {
    // 0.55*80 + 0.25*50 + 0.2*(5000/60000*100) = 44 + 12.5 + 1.67 = 58.17 → 58
    const m = metric({
      component_class: 'cron',
      metrics: { failure_rate: 0.8, duration_ms: 5000, last_run_status: 'failed' },
    });
    const { score } = scoreMetrics('cron', m);
    expect(score).toBe(58);
  });

  it('scores an error-heavy entity high', () => {
    const m = metric({
      component_class: 'entity',
      metrics: { error_rate: 0.9, avg_latency_ms: 3000, staleness_days: 30, health_status: 'crashed' },
    });
    const { score, reasons } = scoreMetrics('entity', m);
    expect(score).toBeGreaterThan(70);
    expect(reasons.some((r) => r.toLowerCase().includes('error'))).toBe(true);
  });

  it('scores a chain with many failed steps exactly', () => {
    // 0.55*50 + 0.25*100 + 0.2*(60000/120000*100) = 27.5 + 25 + 10 = 62.5 → 63
    const m = metric({
      component_class: 'chain',
      metrics: { failed_step_rate: 0.5, duration_ms: 60000, status: 'failed' },
    });
    const { score } = scoreMetrics('chain', m);
    expect(score).toBe(63);
  });

  it('never produces NaN scores from bad metric values', () => {
    const m = metric({
      metrics: { status: 'down', failures: Number.NaN, latency_ms: Number.NaN, uptime_pct: Number.NaN },
    });
    const { score } = scoreMetrics('site', m);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('classifies trend from score history', () => {
    expect(classifyTrend([10, 20, 30])).toBe('worsening');
    expect(classifyTrend([30, 20, 10])).toBe('improving');
    expect(classifyTrend([20, 20, 22])).toBe('flat');
    expect(classifyTrend([])).toBe('flat');
  });
});

describe('buildWeaknessScores', () => {
  it('looks up trend history and passes slug/name/score through', () => {
    const metrics = [
      metric({ component_slug: 'shop', component_name: 'Shop', metrics: { status: 'up', failures: 0, latency_ms: 120, uptime_pct: 100 } }),
      metric({ component_slug: 'blog', component_name: 'Blog', metrics: { status: 'up', failures: 1, latency_ms: 300, uptime_pct: 100 } }),
    ];
    const results = buildWeaknessScores('site', metrics, {
      shop: [10, 20, 30],
      blog: [30, 20, 10],
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      component_class: 'site',
      component_slug: 'shop',
      component_name: 'Shop',
      score: 1,
      trend: 'worsening',
    });
    expect(results[1].trend).toBe('improving');
  });

  it('defaults to flat when a component has no history', () => {
    const results = buildWeaknessScores('site', [metric({ component_slug: 'nohistory' })], {});
    expect(results[0].trend).toBe('flat');
    expect(results[0].component_slug).toBe('nohistory');
  });
});
