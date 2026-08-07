import { describe, expect, it } from 'vitest';
import { DAY_FLOW } from '../src/lib/draymond/day-orchestrator';
import { getSeedJobDefs } from '../src/lib/draymond/business-chains';

describe('brain wiki sync', () => {
  it('has a wiki sync step in the day flow', () => {
    expect(DAY_FLOW.some((s) => s.job === 'wiki_sync')).toBe(true);
  });
});

describe('benchmark seed jobs', () => {
  it('defines staggered benchmark jobs', () => {
    const jobs = getSeedJobDefs();
    const handlers = jobs.filter((j) => j.job_type === 'custom').map((j) => (j.job_config as { handler?: string }).handler);
    expect(handlers).toContain('benchmark_entities');
    expect(handlers).toContain('benchmark_sites');
    expect(handlers).toContain('benchmark_crons');
    expect(handlers).toContain('benchmark_chains');
    expect(handlers).toContain('benchmark_deep_score');
    expect(handlers).toContain('benchmark_upgrade_review');
  });
});
