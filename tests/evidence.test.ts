import { describe, it, expect } from 'vitest';
import {
  scoreConclusion,
  scoreEvidence,
  bandFor,
  statusFor,
  BAND_FLOOR,
  type Evidence,
} from '@/lib/draymond/evidence';

function ev(kind: Evidence['kind'], detail = 'saw it'): Evidence {
  return { kind, detail };
}

describe('evidence scoring', () => {
  it('scores nothing as zero, no band, proposed', () => {
    const r = scoreConclusion({ refId: 'lo_1', subject: 'x', evidence: [] });
    expect(r.score).toBe(0);
    expect(r.band).toBeNull();
    expect(r.hasPrimary).toBe(false);
    expect(r.status).toBe('proposed');
  });

  it('verifies a single primary log observation', () => {
    const r = scoreConclusion({ refId: 'lo_1', subject: 'x', evidence: [ev('log.observed')] });
    expect(r.hasPrimary).toBe(true);
    expect(r.score).toBeCloseTo(0.9, 5);
    expect(r.band).toBe('verified');
    expect(r.status).toBe('verified');
  });

  it('never lets supporting evidence alone reach verified, even at high score', () => {
    // Two independent corroborations combine to 0.84 — high, but not primary.
    const r = scoreConclusion({
      refId: 'lo_1',
      subject: 'x',
      evidence: [ev('corroboration'), ev('corroboration')],
    });
    expect(r.hasPrimary).toBe(false);
    expect(r.score).toBeCloseTo(0.84, 5);
    expect(r.band).toBe('probable');
    expect(r.status).toBe('proposed');
  });

  it('keeps a strong-but-not-verified primary source as a proposal', () => {
    // provenance.verified is 0.8: primary, but below the verified floor.
    const r = scoreConclusion({ refId: 'lo_1', subject: 'x', evidence: [ev('provenance.verified')] });
    expect(r.hasPrimary).toBe(true);
    expect(r.score).toBeLessThan(BAND_FLOOR.VERIFIED);
    expect(r.status).toBe('proposed');
  });

  it('holds a conclusion entirely when contradicted, whatever else is present', () => {
    const r = scoreConclusion({
      refId: 'lo_1',
      subject: 'x',
      evidence: [ev('human.verified'), ev('contradiction', 'log says otherwise')],
    });
    expect(r.contradicted).toBe(true);
    expect(r.score).toBeLessThanOrEqual(0.45);
    expect(r.status).toBe('proposed');
    expect(r.rationale).toMatch(/Held:/);
  });

  it('does not floor at literal certainty', () => {
    const r = scoreConclusion({
      refId: 'lo_1',
      subject: 'x',
      evidence: [ev('human.verified'), ev('log.observed'), ev('data.cited-source'), ev('corroboration')],
    });
    expect(r.score).toBeLessThanOrEqual(0.99);
  });

  it('caps score at the contradiction threshold, not the ceiling', () => {
    const { score } = scoreEvidence([ev('contradiction')]);
    expect(score).toBe(0);
  });

  it('statusFor / bandFor agree for the verified band', () => {
    expect(bandFor(0.9, true)).toBe('verified');
    expect(statusFor([ev('log.observed')], 0.9, true, false)).toBe('verified');
    expect(bandFor(0.9, false)).not.toBe('verified');
  });
});
