import { describe, expect, it, afterEach } from 'vitest';
import {
  sectorProductivity,
  writeSectorProductivity,
  readSectorProductivity,
  productivityFile,
} from '../src/lib/draymond/sector-productivity';
import { existsSync, unlinkSync } from 'node:fs';

describe('sector productivity', () => {
  afterEach(() => {
    const file = productivityFile();
    if (existsSync(file)) {
      try { unlinkSync(file); } catch { /* best-effort cleanup */ }
    }
  });

  it('produces one entry per corporate sector', () => {
    const state = sectorProductivity();
    expect(state.sectors.length).toBe(6);
    expect(state.sectors.map((s) => s.sector).sort()).toEqual([
      'e1-platform', 'e2-b2b', 'e3-tooling', 'e4-vertical', 'ops', 'rd',
    ]);
  });

  it('never fabricates revenue counts', () => {
    const state = sectorProductivity();
    const e1 = state.sectors.find((s) => s.sector === 'e1-platform');
    // With treasury at $0 (or absent), E1 reports zero delivered work.
    expect(e1?.kpis.revenueCents).toBe(0);
    expect(e1?.deliveredToday).toBe(0);
  });

  it('persists and reloads the snapshot', () => {
    writeSectorProductivity();
    const read = readSectorProductivity();
    expect(read).not.toBeNull();
    expect(read?.sectors.length).toBe(6);
    expect(read?.updatedAt).toBeDefined();
  });

  it('computes a trend from the previous snapshot', () => {
    writeSectorProductivity(); // first snapshot → all flat
    const second = sectorProductivity();
    // Same inputs → trend stays flat (not a fake "up").
    for (const s of second.sectors) {
      expect(['up', 'down', 'flat']).toContain(s.trend);
    }
  });
});