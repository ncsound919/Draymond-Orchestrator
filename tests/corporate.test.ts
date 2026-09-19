import { describe, expect, it } from 'vitest';
import {
  OFFICES,
  SECTORS,
  ENGINE_TARGETS,
  MONTHLY_TARGET,
  POOL_SHARE,
  sectorDailyCap,
  sectorCaps,
  sectorCapsTotal,
  sectorFor,
  sectorMemberSlugs,
  orgSnapshot,
  REVENUE_SECTOR_IDS,
  engineWeight,
} from '../src/lib/draymond/corporate';

describe('corporate org chart', () => {
  it('has all six C-suite offices', () => {
    expect(OFFICES.map((o) => o.id).sort()).toEqual(['ceo', 'cfo', 'ciso', 'cmo', 'coo', 'cto']);
  });

  it('every sector is owned by exactly one office', () => {
    for (const s of SECTORS) {
      const owners = OFFICES.filter((o) => o.owns.includes(s.id));
      expect(owners.length, `sector ${s.id} should have one owner`).toBe(1);
    }
  });

  it('revenue engines sum to the $33k monthly mission', () => {
    expect(MONTHLY_TARGET).toBe(33_000);
    expect(Object.values(ENGINE_TARGETS).reduce((a, b) => a + b, 0)).toBe(33_000);
  });

  it('engine weights match revenue targets', () => {
    expect(engineWeight('E1')).toBeCloseTo(10_000 / 33_000, 6);
    expect(engineWeight('E2')).toBeCloseTo(12_000 / 33_000, 6);
    expect(engineWeight('E3')).toBeCloseTo(6_000 / 33_000, 6);
    expect(engineWeight('E4')).toBeCloseTo(5_000 / 33_000, 6);
  });

  it('has four revenue sectors and two overhead pools', () => {
    expect(REVENUE_SECTOR_IDS).toEqual(['e1-platform', 'e2-b2b', 'e3-tooling', 'e4-vertical']);
    expect(SECTORS.filter((s) => s.pool === 'ops').map((s) => s.id)).toEqual(['ops']);
    expect(SECTORS.filter((s) => s.pool === 'rd').map((s) => s.id)).toEqual(['rd']);
  });
});

describe('corporate allocation math', () => {
  const BUDGET = 5_000_000;

  it('sector caps total exactly the fleet budget', () => {
    const total = sectorCapsTotal(BUDGET);
    expect(Math.abs(total - BUDGET)).toBeLessThanOrEqual(6); // rounding
  });

  it('revenue sectors get 70% of the fleet, weighted by target', () => {
    const caps = sectorCaps(BUDGET);
    const revenueTotal = REVENUE_SECTOR_IDS.reduce((a, s) => a + caps[s], 0);
    expect(revenueTotal).toBeCloseTo(BUDGET * POOL_SHARE.revenue, -1);

    // E2 (biggest target $12k) > E1 ($10k) > E3 ($6k) > E4 ($5k)
    expect(caps['e2-b2b']).toBeGreaterThan(caps['e1-platform']);
    expect(caps['e1-platform']).toBeGreaterThan(caps['e3-tooling']);
    expect(caps['e3-tooling']).toBeGreaterThan(caps['e4-vertical']);
  });

  it('ops and rd each get 15% of the fleet', () => {
    const caps = sectorCaps(BUDGET);
    expect(caps.ops).toBeCloseTo(BUDGET * 0.15, -1);
    expect(caps.rd).toBeCloseTo(BUDGET * 0.15, -1);
  });

  it('E2 (36% of engine targets) owns the largest slice', () => {
    const caps = sectorCaps(BUDGET);
    const e2 = caps['e2-b2b'];
    const others = REVENUE_SECTOR_IDS.filter((s) => s !== 'e2-b2b').map((s) => caps[s]);
    expect(e2).toBeGreaterThan(Math.max(...others));
  });

  it('derives the same caps for any fleet budget', () => {
    expect(Math.abs(sectorCapsTotal(1_000_000) - 1_000_000)).toBeLessThanOrEqual(6);
    const cap2 = sectorDailyCap('e2-b2b', 1_000_000);
    // E2 share of revenue pool = 12/33 * 0.7 * 1M
    expect(cap2).toBe(Math.round(1_000_000 * 0.7 * (12 / 33)));
  });
});

describe('corporate slug mapping', () => {
  it('maps revenue-work handlers to their sectors', () => {
    expect(sectorFor('treasury_pulse')).toBe('e1-platform');
    expect(sectorFor('aetherdesk')).toBe('e2-b2b');
    expect(sectorFor('depscan')).toBe('e3-tooling');
    expect(sectorFor('sports-steve')).toBe('e4-vertical');
  });

  it('maps overhead handlers to ops/rd', () => {
    expect(sectorFor('rd_night')).toBe('rd');
    expect(sectorFor('dream_cycle')).toBe('rd');
    expect(sectorFor('service_health_repair')).toBe('ops');
    expect(sectorFor('litellm')).toBe('ops');
  });

  it('defaults unlisted work to ops overhead', () => {
    expect(sectorFor('totally-unplanned-thing')).toBe('ops');
  });

  it('every sector has at least one member', () => {
    for (const s of SECTORS) {
      expect(sectorMemberSlugs(s.id).length, `sector ${s.id} should have members`).toBeGreaterThan(0);
    }
  });

  it('the delegation plan covers every revenue engine with real work', () => {
    for (const id of REVENUE_SECTOR_IDS) {
      expect(sectorMemberSlugs(id).length).toBeGreaterThan(1);
    }
  });
});

describe('corporate org snapshot', () => {
  it('exposes offices + sectors with caps + member slugs', () => {
    const snap = orgSnapshot(5_000_000);
    expect(snap.offices.length).toBe(6);
    expect(snap.sectors.length).toBe(SECTORS.length);
    for (const s of snap.sectors) {
      expect(s.dailyCap).toBeGreaterThan(0);
      expect(s.memberSlugs.length).toBeGreaterThan(0);
      expect(s.office.id).toBeDefined();
    }
  });
});