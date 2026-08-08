import { describe, expect, it } from 'vitest';
import { rankByExpectedValue, costAwareOrder } from '@/lib/mathx/optimize';

describe('rankByExpectedValue', () => {
  it('ranks by probability × impact descending', () => {
    const ranked = rankByExpectedValue([
      { id: 'a', probability: 0.5, impact: 1, age: 0 },
      { id: 'b', probability: 1, impact: 0.4, age: 0 },
      { id: 'c', probability: 0.9, impact: 0.2, age: 0 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(ranked[0].score).toBeCloseTo(0.5, 12);
  });

  it('decays by age exponentially', () => {
    const ranked = rankByExpectedValue(
      [
        { id: 'old', probability: 1, impact: 1, age: 24 },
        { id: 'new', probability: 1, impact: 1, age: 0 },
      ],
      Math.log(2) / 24, // halflife of 24h
    );
    expect(ranked[0].id).toBe('new');
    expect(ranked[1].score).toBeCloseTo(0.5, 10);
  });

  it('surfaces the most likely fix on score ties', () => {
    const ranked = rankByExpectedValue([
      { id: 'lowP', probability: 0.2, impact: 0.5, age: 0 },
      { id: 'highP', probability: 0.5, impact: 0.2, age: 0 },
    ]);
    expect(ranked[0].id).toBe('highP');
  });

  it('handles empty input', () => {
    expect(rankByExpectedValue([])).toEqual([]);
  });
});

describe('costAwareOrder', () => {
  const jobs = [
    { id: 'j1', tokens: 10, costPerToken: 1, deadline: 5, weight: 1 },
    { id: 'j2', tokens: 10, costPerToken: 1, deadline: 1, weight: 2 },
    { id: 'j3', tokens: 1000, costPerToken: 1, deadline: 3, weight: 3 },
  ];

  it('schedules by earliest deadline within budget', () => {
    const { scheduled, dropped } = costAwareOrder(jobs, 25);
    expect(scheduled.map((s) => s.id)).toEqual(['j2', 'j1']);
    expect(dropped).toEqual(['j3']);
    expect(scheduled[scheduled.length - 1].totalCost).toBe(20);
  });

  it('drops everything when the budget cannot cover any job', () => {
    const { scheduled, dropped } = costAwareOrder(jobs, 5);
    expect(scheduled).toEqual([]);
    expect(dropped.sort()).toEqual(['j1', 'j2', 'j3'].sort());
  });

  it('orders by deadline, breaking ties by weight', () => {
    const { scheduled } = costAwareOrder(
      [
        { id: 'heavy', tokens: 1, costPerToken: 1, deadline: 2, weight: 9 },
        { id: 'light', tokens: 1, costPerToken: 1, deadline: 2, weight: 1 },
      ],
      10,
    );
    expect(scheduled.map((s) => s.id)).toEqual(['heavy', 'light']);
  });

  it('ignores zero-token jobs', () => {
    const { scheduled, dropped } = costAwareOrder(
      [{ id: 'free', tokens: 0, costPerToken: 1, deadline: 1, weight: 1 }],
      10,
    );
    expect(scheduled).toEqual([]);
    expect(dropped).toEqual([]);
  });
});
