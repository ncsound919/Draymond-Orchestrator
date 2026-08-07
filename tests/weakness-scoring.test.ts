import { describe, expect, it } from 'vitest';
import { scoreMetrics, classifyTrend } from '../src/lib/draymond/weakness-scoring';

describe('weakness scoring', () => {
  it('scores a healthy site low', () => {
    const m = { metrics: { status: 'up', failures: 0, latency_ms: 120, uptime_pct: 100 }, evidence: '' } as never;
    const { score, reasons } = scoreMetrics('site', m);
    expect(score).toBeLessThan(20);
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('scores a failing site high', () => {
    const m = { metrics: { status: 'down', failures: 6, latency_ms: null, uptime_pct: 0 }, evidence: '' } as never;
    const { score } = scoreMetrics('site', m);
    expect(score).toBeGreaterThan(60);
  });

  it('scores a failing cron higher than a healthy one', () => {
    const bad = scoreMetrics('cron', { metrics: { failure_rate: 0.8, duration_ms: 5000, last_run_status: 'failed' }, evidence: '' } as never);
    const good = scoreMetrics('cron', { metrics: { failure_rate: 0.0, duration_ms: 500, last_run_status: 'success' }, evidence: '' } as never);
    expect(bad.score).toBeGreaterThan(good.score);
  });

  it('scores an error-heavy entity high', () => {
    const { score, reasons } = scoreMetrics('entity', { metrics: { error_rate: 0.9, avg_latency_ms: 3000, staleness_days: 30, health_status: 'crashed' }, evidence: '' } as never);
    expect(score).toBeGreaterThan(70);
    expect(reasons.some((r) => r.toLowerCase().includes('error'))).toBe(true);
  });

  it('scores a chain with many failed steps high', () => {
    const { score } = scoreMetrics('chain', { metrics: { failed_step_rate: 0.5, duration_ms: 60000, status: 'failed' }, evidence: '' } as never);
    expect(score).toBeGreaterThan(60);
  });

  it('classifies trend from score history', () => {
    expect(classifyTrend([10, 20, 30])).toBe('worsening');
    expect(classifyTrend([30, 20, 10])).toBe('improving');
    expect(classifyTrend([20, 20, 22])).toBe('flat');
    expect(classifyTrend([])).toBe('flat');
  });
});
