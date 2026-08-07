import { describe, expect, it } from 'vitest';
import { DAY_FLOW } from '../src/lib/draymond/day-orchestrator';

describe('brain wiki sync', () => {
  it('has a wiki sync step in the day flow', () => {
    expect(DAY_FLOW.some((s) => s.job === 'wiki_sync')).toBe(true);
  });
});
