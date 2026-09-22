import { describe, expect, it } from 'vitest';
import {
  MUSIC_SHIFT_AUTO_RATE_DEFAULT,
  MUSIC_SHIFT_RATING_SOURCE,
  MUSIC_SHIFT_SEQUENCE,
  MUSIC_SHIFT_SLUGS,
  MUSIC_SHIFT_VERIFIED_ENDPOINTS,
} from '../src/lib/draymond/shift-music';
import type { DelegationSpec } from '../src/lib/draymond/delegation';

const DELEGATION_KEYS: Array<keyof DelegationSpec> = [
  'slug',
  'label',
  'phase',
  'timeBudgetMs',
  'tokenBudgetPerRun',
  'tokenBudgetPerDay',
  'tier',
  'priority',
  'duty',
];

describe('MUSIC_SHIFT_SLUGS delegation shape', () => {
  it('exposes the two locked-plan slugs with all required delegation keys', () => {
    const slugs = MUSIC_SHIFT_SLUGS.map((s) => s.slug);
    expect(slugs).toEqual(expect.arrayContaining(['recourse_compose', 'recourse_rating']));

    for (const spec of MUSIC_SHIFT_SLUGS) {
      for (const key of DELEGATION_KEYS) {
        expect(spec, `missing delegation key ${key} on ${spec.slug}`).toHaveProperty(key);
      }
      expect(spec.phase).toBe('night');
      expect(spec.duty).toBe('night');
      expect(spec.priority).toBeGreaterThanOrEqual(1);
      expect(spec.priority).toBeLessThanOrEqual(3);
    }
  });

  it('keeps the locked budgets (compose 900s/64k/96k flash, rating 120s/8k/16k free)', () => {
    const compose = MUSIC_SHIFT_SLUGS.find((s) => s.slug === 'recourse_compose');
    const rating = MUSIC_SHIFT_SLUGS.find((s) => s.slug === 'recourse_rating');

    expect(compose).toMatchObject({
      timeBudgetMs: 900_000,
      tokenBudgetPerRun: 64_000,
      tokenBudgetPerDay: 96_000,
      tier: 'flash',
    });
    expect(rating).toMatchObject({
      timeBudgetMs: 120_000,
      tokenBudgetPerRun: 8_000,
      tokenBudgetPerDay: 16_000,
      tier: 'free',
    });
  });
});

describe('MUSIC_SHIFT_SEQUENCE endpoint contract', () => {
  it('references only real recourse compose/rating routes', () => {
    expect(MUSIC_SHIFT_SEQUENCE.length).toBeGreaterThan(0);
    for (const step of MUSIC_SHIFT_SEQUENCE) {
      expect(MUSIC_SHIFT_VERIFIED_ENDPOINTS, `${step.key} -> ${step.path} is not a verified recourse route`).toContain(step.path);
      expect(['GET', 'POST']).toContain(step.method);
    }
  });

  it('runs the ordered loop: suggest -> rate -> variation/pair -> standings -> export -> soundlab', () => {
    const keys = MUSIC_SHIFT_SEQUENCE.map((s) => s.key);
    expect(keys).toEqual([
      'compose_suggest',
      'compose_rate',
      'rating_variation',
      'rating_pair',
      'rating_standings',
      'compose_export',
      'compose_soundlab',
    ]);
  });

  it('tags the rating store with the chordstudio source', () => {
    for (const step of MUSIC_SHIFT_SEQUENCE) {
      if (step.path.includes('/rating/variation') || step.path.includes('/rating/pair')) {
        expect(step.body).toHaveProperty('source', MUSIC_SHIFT_RATING_SOURCE);
      }
    }
  });
});

describe('autoRate guard', () => {
  it('defaults OFF — the shift never writes taste signals without operator opt-in', () => {
    expect(MUSIC_SHIFT_AUTO_RATE_DEFAULT).toBe(false);
  });

  it('guards the two taste-writing steps (learner rate + blind A/B pair)', () => {
    const guarded = MUSIC_SHIFT_SEQUENCE.filter((s) => s.autoRateGuard).map((s) => s.key);
    expect(guarded).toEqual(expect.arrayContaining(['compose_rate', 'rating_pair']));
  });
});