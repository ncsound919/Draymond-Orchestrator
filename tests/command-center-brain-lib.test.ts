// ============================================================================
// Command Center — Brain cockpit lib (pure unit tests, no network/server)
// ============================================================================
import { describe, expect, it } from 'vitest';
import {
  severityColor,
  findingStatusColor,
  sweepModeLabel,
  formatCoverage,
  isFullCoverage,
  sortFindings,
  findingCounts,
  type CoverageLike,
  type FindingLike,
} from '@/components/command-center/brain-lib';

function finding(over: Partial<FindingLike> = {}): FindingLike {
  return { node_id: 'n1', severity: 'high', confidence: 0.8, status: 'open', ...over };
}

describe('severityColor', () => {
  it('maps known severities and falls back to gray', () => {
    expect(severityColor('critical')).toContain('text-red-400');
    expect(severityColor('high')).toContain('text-orange-400');
    expect(severityColor('low')).toContain('text-blue-400');
    expect(severityColor('weird')).toContain('text-gray-400');
    expect(severityColor(null)).toContain('text-gray-400');
  });
});

describe('findingStatusColor', () => {
  it('maps statuses and falls back to gray', () => {
    expect(findingStatusColor('open')).toContain('text-yellow-400');
    expect(findingStatusColor('applied')).toContain('text-green-400');
    expect(findingStatusColor('resolved')).toContain('text-green-400');
    expect(findingStatusColor(null)).toContain('text-gray-400');
  });
});

describe('sweepModeLabel', () => {
  it('labels known modes and capitalizes unknown', () => {
    expect(sweepModeLabel('manual')).toBe('Manual');
    expect(sweepModeLabel('auto')).toBe('Auto');
    expect(sweepModeLabel('custom')).toBe('Custom');
    expect(sweepModeLabel(null)).toBe('Manual');
  });
});

describe('formatCoverage', () => {
  it('formats covered/total (pct%)', () => {
    const c: CoverageLike = { total: 4, covered: 3, pct: 75, degraded: false };
    expect(formatCoverage(c)).toBe('3/4 (75%)');
  });
  it('returns — for null or zero-total', () => {
    expect(formatCoverage(null)).toBe('—');
    expect(formatCoverage({ total: 0, covered: 0, pct: 0, degraded: false })).toBe('—');
  });
});

describe('isFullCoverage', () => {
  it('true only when covered >= total and total > 0', () => {
    expect(isFullCoverage({ total: 4, covered: 4, pct: 100, degraded: false })).toBe(true);
    expect(isFullCoverage({ total: 4, covered: 3, pct: 75, degraded: false })).toBe(false);
    expect(isFullCoverage({ total: 0, covered: 0, pct: 0, degraded: false })).toBe(false);
    expect(isFullCoverage(null)).toBe(false);
  });
});

describe('sortFindings', () => {
  it('sorts by severity rank then confidence, capped', () => {
    const input = [
      finding({ node_id: 'low', severity: 'low', confidence: 0.9 }),
      finding({ node_id: 'crit', severity: 'critical', confidence: 0.5 }),
      finding({ node_id: 'med', severity: 'medium', confidence: 0.7 }),
    ];
    const out = sortFindings(input, 10);
    expect(out.map((f) => f.node_id)).toEqual(['crit', 'med', 'low']);
  });
  it('caps and does not mutate input', () => {
    const input = [finding({ node_id: 'a' }), finding({ node_id: 'b' }), finding({ node_id: 'c' })];
    const out = sortFindings(input, 2);
    expect(out).toHaveLength(2);
    expect(input).toHaveLength(3);
    expect(sortFindings(null)).toEqual([]);
    expect(sortFindings([])).toEqual([]);
  });
});

describe('findingCounts', () => {
  it('counts open-ish vs total', () => {
    const counts = findingCounts([
      finding({ status: 'open' }),
      finding({ status: 'applied' }),
      finding({ status: 'resolved' }),
    ]);
    expect(counts.open).toBe(2);
    expect(counts.total).toBe(3);
    expect(findingCounts(null)).toEqual({ open: 0, total: 0 });
  });
});
