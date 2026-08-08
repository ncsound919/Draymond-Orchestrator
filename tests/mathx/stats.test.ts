import { describe, expect, it } from 'vitest';
import {
  percentile,
  regularizedIncompleteBeta,
  inverseRegularizedIncompleteBeta,
  betaPosterior,
  shrinkage,
  ewma,
  cusum,
  normalCdf,
  sigmoid,
} from '@/lib/mathx/stats';

describe('percentile', () => {
  it('interpolates linearly (R type 7)', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 10);
    expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10);
  });

  it('returns endpoints at 0 and 1', () => {
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
  });

  it('handles empty and single-element arrays', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([5], 0.5)).toBe(5);
  });

  it('clamps p to [0, 1]', () => {
    expect(percentile([1, 2, 3, 4], -1)).toBe(1);
    expect(percentile([1, 2, 3, 4], 2)).toBe(4);
  });
});

describe('regularized incomplete beta', () => {
  it('is a CDF: I_0 = 0, I_1 = 1', () => {
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0);
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1);
  });

  it('is the uniform CDF for Beta(1,1)', () => {
    expect(regularizedIncompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 10);
    expect(regularizedIncompleteBeta(0.2, 1, 1)).toBeCloseTo(0.2, 10);
  });

  it('rejects non-positive shape params', () => {
    expect(() => regularizedIncompleteBeta(0.5, 0, 1)).toThrow(RangeError);
  });
});

describe('inverse regularized incomplete beta', () => {
  it('recovers the uniform quantiles for Beta(1,1)', () => {
    expect(inverseRegularizedIncompleteBeta(0.025, 1, 1)).toBeCloseTo(0.025, 10);
    expect(inverseRegularizedIncompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 10);
    expect(inverseRegularizedIncompleteBeta(0.975, 1, 1)).toBeCloseTo(0.975, 10);
  });

  it('is symmetric for symmetric beta shapes', () => {
    const lo = inverseRegularizedIncompleteBeta(0.025, 11, 11);
    const hi = inverseRegularizedIncompleteBeta(0.975, 11, 11);
    expect(lo).toBeCloseTo(1 - hi, 8);
  });

  it('round-trips through the CDF', () => {
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const q = inverseRegularizedIncompleteBeta(p, 4, 7);
      expect(regularizedIncompleteBeta(q, 4, 7)).toBeCloseTo(p, 8);
    }
  });
});

describe('betaPosterior', () => {
  it('matches hand-computed Beta(10, 2) statistics', () => {
    const post = betaPosterior(9, 1, 1, 1);
    expect(post.alpha).toBe(10);
    expect(post.beta).toBe(2);
    expect(post.mean).toBeCloseTo(10 / 12, 6);
    expect(post.sd).toBeCloseTo(Math.sqrt((10 * 2) / (144 * 13)), 6);
    expect(post.ciLow).toBeGreaterThan(0);
    expect(post.ciHigh).toBeLessThan(1);
    expect(post.ciLow).toBeLessThan(post.mean);
    expect(post.mean).toBeLessThan(post.ciHigh);
  });

  it('Beta(1,1) uniform prior yields uniform posterior stats', () => {
    const post = betaPosterior(0, 0, 1, 1);
    expect(post.mean).toBeCloseTo(0.5, 10);
    expect(post.ciLow).toBeCloseTo(0.025, 8);
    expect(post.ciHigh).toBeCloseTo(0.975, 8);
  });

  it('symmetric data under a symmetric prior is symmetric', () => {
    const post = betaPosterior(10, 10, 1, 1);
    expect(post.mean).toBeCloseTo(0.5, 10);
    expect(post.ciLow).toBeCloseTo(1 - post.ciHigh, 8);
  });

  it('wide interval for tiny samples, narrow for large samples', () => {
    const small = betaPosterior(1, 0, 1, 1);
    const large = betaPosterior(100, 0, 1, 1);
    expect(small.width).toBeGreaterThan(large.width);
  });

  it('confidence shrinks toward the prior when evidence is thin', () => {
    // 1-for-1 (rate 1.0) with prior 0.5/strength 2 must NOT report 1.0.
    const post = betaPosterior(1, 0, 1, 1);
    expect(post.mean).toBeCloseTo(2 / 3, 10);
    expect(post.mean).toBeLessThan(1);
  });
});

describe('shrinkage', () => {
  it('hand-computed pull toward prior', () => {
    expect(shrinkage(1, 2, 0.75, 5)).toBeCloseTo((5 * 0.75 + 2) / 7, 10);
  });

  it('returns the prior with zero samples', () => {
    expect(shrinkage(0.8, 0, 0.75, 5)).toBeCloseTo(0.75, 10);
  });

  it('keeps the observed rate as n grows', () => {
    expect(shrinkage(1, 1000, 0.5, 5)).toBeGreaterThan(0.99);
  });

  it('guards zero strength + zero samples', () => {
    expect(shrinkage(0.4, 0, 0.5, 0)).toBe(0.4);
  });
});

describe('ewma', () => {
  it('returns empty series for no data', () => {
    expect(ewma([])).toEqual({ series: [], last: null, halflife: expect.any(Number) });
  });

  it('lambda=1 keeps the raw series', () => {
    const r = ewma([10, 20], 1);
    expect(r.series).toEqual([10, 20]);
    expect(r.last).toBe(20);
  });

  it('hand-computed smoothing at lambda=0.5', () => {
    const r = ewma([1, 2, 3], 0.5);
    expect(r.series).toEqual([1, 1.5, 2.25]);
    expect(r.last).toBeCloseTo(2.25, 10);
  });

  it('halflife is 1 sample at lambda=0.5', () => {
    expect(ewma([1], 0.5).halflife).toBeCloseTo(1, 10);
  });
});

describe('cusum', () => {
  it('no alarms when on target', () => {
    const r = cusum([10, 10, 10, 10], { target: 10 });
    expect(r.alarms).toEqual([]);
    expect(r.lastHigh).toBe(0);
    expect(r.lastLow).toBe(0);
  });

  it('ignores sub-threshold noise', () => {
    const r = cusum([1, 1, 1, 1], { target: 0, sigma: 1, k: 0.5, h: 5 });
    expect(r.alarms).toEqual([]);
    expect(r.lastHigh).toBeCloseTo(2, 10);
  });

  it('alarms on sustained high drift', () => {
    const r = cusum([3, 3, 3], { target: 0, sigma: 1, k: 0.5, h: 5 });
    expect(r.alarms).toHaveLength(1);
    expect(r.alarms[0].index).toBe(2);
    expect(r.alarms[0].direction).toBe('high');
    expect(r.alarms[0].magnitude).toBeGreaterThan(5);
  });

  it('alarms on sustained low drift', () => {
    const r = cusum([-3, -3, -3], { target: 0, sigma: 1, k: 0.5, h: 5 });
    expect(r.alarms).toHaveLength(1);
    expect(r.alarms[0].direction).toBe('low');
  });
});

describe('normalCdf', () => {
  it('hand-computed standard values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 4);
    expect(normalCdf(2.576)).toBeCloseTo(0.995, 3);
  });
});

describe('sigmoid', () => {
  it('maps 0 to 0.5 and clamps overflow', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(1)).toBeCloseTo(1 / (1 + Math.exp(-1)), 10);
    expect(sigmoid(1000)).toBeCloseTo(1, 6);
    expect(sigmoid(-1000)).toBeCloseTo(0, 6);
  });

  it('is monotone increasing', () => {
    expect(sigmoid(-2)).toBeLessThan(sigmoid(0));
    expect(sigmoid(0)).toBeLessThan(sigmoid(2));
  });
});
