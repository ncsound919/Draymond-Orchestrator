// ============================================================================
// Command Center — Science (CureMind / biotech) lib (pure unit tests)
// ============================================================================
import { describe, expect, it } from 'vitest';
import {
  goalStatusPill,
  experimentStatusPill,
  experimentTypeLabel,
  priorityLabel,
  priorityPill,
  discoveryPill,
  sortDiscoveriesByScore,
  clampTicks,
  clampParam,
  type DiscoveryLike,
} from '@/components/command-center/sci-lib';

describe('goalStatusPill', () => {
  it('maps goal statuses and falls back to gray', () => {
    expect(goalStatusPill('active')).toContain('text-green-400');
    expect(goalStatusPill('paused')).toContain('text-yellow-400');
    expect(goalStatusPill('archived')).toContain('text-gray-400');
    expect(goalStatusPill(null)).toContain('text-gray-400');
  });
});

describe('experimentStatusPill', () => {
  it('maps experiment statuses', () => {
    expect(experimentStatusPill('queued')).toContain('text-blue-400');
    expect(experimentStatusPill('running')).toContain('text-yellow-400');
    expect(experimentStatusPill('completed')).toContain('text-green-400');
    expect(experimentStatusPill('failed')).toContain('text-red-400');
    expect(experimentStatusPill('x')).toContain('text-gray-400');
  });
});

describe('experimentTypeLabel', () => {
  it('labels known types and passes through unknown', () => {
    expect(experimentTypeLabel('analysis')).toBe('Analysis');
    expect(experimentTypeLabel('simulation')).toBe('Simulation');
    expect(experimentTypeLabel('biotech')).toBe('Biotech');
    expect(experimentTypeLabel('custom')).toBe('custom');
    expect(experimentTypeLabel(null)).toBe('—');
  });
});

describe('priorityLabel / priorityPill', () => {
  it('labels priority bands', () => {
    expect(priorityLabel(90)).toBe('Critical');
    expect(priorityLabel(70)).toBe('High');
    expect(priorityLabel(50)).toBe('Medium');
    expect(priorityLabel(30)).toBe('Low');
    expect(priorityLabel(10)).toBe('Minimal');
    expect(priorityLabel(null)).toBe('—');
  });
  it('pills priority bands', () => {
    expect(priorityPill(90)).toContain('text-red-400');
    expect(priorityPill(70)).toContain('text-orange-400');
    expect(priorityPill(50)).toContain('text-yellow-400');
    expect(priorityPill(10)).toContain('text-blue-400');
    expect(priorityPill(Number.NaN)).toContain('text-gray-400');
  });
});

describe('discoveryPill', () => {
  it('bands by score', () => {
    expect(discoveryPill(90)).toContain('text-emerald-400');
    expect(discoveryPill(70)).toContain('text-blue-400');
    expect(discoveryPill(45)).toContain('text-yellow-400');
    expect(discoveryPill(10)).toContain('text-gray-400');
    expect(discoveryPill(null)).toContain('text-gray-400');
  });
});

describe('sortDiscoveriesByScore', () => {
  it('sorts by score desc, capped, does not mutate', () => {
    const input: DiscoveryLike[] = [
      { goalId: 'a', score: 10 },
      { goalId: 'b', score: 90 },
      { goalId: 'c', score: 50 },
    ];
    const out = sortDiscoveriesByScore(input, 10);
    expect(out.map((d) => d.goalId)).toEqual(['b', 'c', 'a']);
    expect(input[0].goalId).toBe('a');
    expect(sortDiscoveriesByScore(null)).toEqual([]);
    expect(sortDiscoveriesByScore([], 5)).toEqual([]);
  });
});

describe('clampTicks / clampParam', () => {
  it('clamps ticks into range, NaN → default', () => {
    expect(clampTicks(250)).toBe(250);
    expect(clampTicks(-5)).toBe(1);
    expect(clampTicks(99_999)).toBe(10_000);
    expect(clampTicks(Number.NaN)).toBe(100);
  });
  it('clamps params into [min,max], NaN → fallback', () => {
    expect(clampParam(5, 0, 10, 1)).toBe(5);
    expect(clampParam(50, 0, 10, 1)).toBe(10);
    expect(clampParam(-1, 0, 10, 1)).toBe(0);
    expect(clampParam(Number.NaN, 0, 10, 1)).toBe(1);
  });
});
