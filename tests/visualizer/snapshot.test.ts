import { describe, expect, it } from 'vitest';
import { normalizeServices, normalizeAgents, normalizeJobs } from '../../src/lib/visualizer/snapshot';

describe('visualizer snapshot normalization', () => {
  it('normalizes service health entries to visualizer shape', () => {
    const out = normalizeServices([
      { slug: 'litellm', name: 'LiteLLM', url: 'http://localhost:4100', up: true, detail: 'HTTP 200' },
      { slug: 'claw', name: 'Claw', url: null, up: false, detail: 'timeout' },
    ]);
    expect(out[0]).toEqual({ slug: 'litellm', name: 'LiteLLM', category: 'coding', port: 4100, up: true });
  });

  it('normalizes heartbeat map to agent list', () => {
    const out = normalizeAgents({
      grader: { slug: 'grader', name: 'Grader', last_seen: 'x', up: true, detail: '' },
    });
    expect(out).toEqual([{ slug: 'grader', name: 'Grader', up: true }]);
  });

  it('normalizes scheduler jobs to radar shape', () => {
    const out = normalizeJobs([
      { id: 'a', name: 'kairos_scan', next_run_at: '2026-08-27T01:00:00Z', last_run_status: 'success' },
    ]);
    expect(out[0]).toEqual({
      id: 'a',
      name: 'kairos_scan',
      next_run_at: '2026-08-27T01:00:00Z',
      last_run_status: 'success',
    });
  });
});