import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  DELEGATION_PLAN,
  delegationFor,
  delegationConsumed,
  delegationRemaining,
  recordDelegationConsumption,
  canDelegate,
  isWithinWindow,
  delegationRunTokens,
  delegationTimeBudgetMs,
  delegationTimeoutSeconds,
  resetDelegation,
  delegationSnapshot,
  fleetDailyBudget,
  phaseBudget,
  PHASE_WEIGHT,
  canDelegateSector,
  sectorConsumed,
  sectorRemaining,
  specSector,
  isRevenueSector,
} from '../src/lib/draymond/delegation';
import { dayTokenBudget, DAY_FLOW, estimateStepTokens } from '../src/lib/draymond/day-orchestrator';
import { sectorDailyCap, sectorFor } from '../src/lib/draymond/corporate';

describe('delegation plan', () => {
  beforeEach(() => resetDelegation());
  afterEach(() => resetDelegation());

  it('has unique slugs and a realistic fleet budget', () => {
    const slugs = DELEGATION_PLAN.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(fleetDailyBudget()).toBeGreaterThanOrEqual(5_000_000);
  });

  it('phase budgets split the fleet cap across the four phases', () => {
    const total = ['morning', 'midday', 'evening', 'night'].reduce(
      (a, p) => a + phaseBudget(p as keyof typeof PHASE_WEIGHT),
      0,
    );
    // ±2 tokens for rounding; total ≈ fleetDailyBudget
    expect(Math.abs(total - fleetDailyBudget())).toBeLessThanOrEqual(4);
  });

  it('covers every DAY_FLOW step job with a per-run token budget', () => {
    for (const step of DAY_FLOW) {
      const spec = delegationFor(step.job);
      if (!spec) {
        // Unplanned steps still fall back to the prose heuristic; that's fine.
        expect(estimateStepTokens(step)).toBeGreaterThan(0);
        continue;
      }
      expect(spec.tokenBudgetPerRun).toBeGreaterThan(0);
      expect(spec.tokenBudgetPerDay).toBeGreaterThanOrEqual(spec.tokenBudgetPerRun);
    }
  });

  it('enriches day flow steps with delegation durations + budgets', () => {
    const market = DAY_FLOW.find((s) => s.id === 'market');
    expect(market?.job).toBe('fetch_market_data');
    const spec = delegationFor('fetch_market_data');
    expect(market?.tokenBudget).toBe(spec?.tokenBudgetPerRun);
    expect(market?.durationMs).toBe(spec?.timeBudgetMs);
    expect(dayTokenBudget().total).toBeGreaterThan(0);
  });

  it('tracks per-day consumption and rolls over', () => {
    recordDelegationConsumption('ingest_news', 5_000);
    expect(delegationConsumed('ingest_news')).toBe(5_000);
    expect(delegationRemaining('ingest_news')).toBe(
      delegationFor('ingest_news')!.tokenBudgetPerDay - 5_000,
    );
  });

  it('canDelegate is gated by time window and daily budget', () => {
    // 10:00 local — inside the morning/midday windows for most components.
    const morning = new Date(2026, 7, 6, 10, 0);
    expect(canDelegate('ingest_news', morning).ok).toBe(true);

    // Exhaust the daily budget → gated.
    const spec = delegationFor('ingest_news')!;
    recordDelegationConsumption('ingest_news', spec.tokenBudgetPerDay);
    expect(canDelegate('ingest_news', morning).ok).toBe(false);
    expect(canDelegate('ingest_news', morning).reason).toContain('exhausted');
  });

  it('respects shift-day windows (trading only on weekdays)', () => {
    const friday = new Date(2026, 7, 7, 10, 0); // 2026-08-07 is a Friday
    const sunday = new Date(2026, 7, 9, 10, 0); // Sunday
    expect(isWithinWindow(delegationFor('trading-agents')!, friday)).toBe(true);
    expect(isWithinWindow(delegationFor('trading-agents')!, sunday)).toBe(false);
  });

  it('applies overnight windows correctly (night mode)', () => {
    const spec = delegationFor('omniresearch-pro')!;
    expect(isWithinWindow(spec, new Date(2026, 7, 6, 23, 0))).toBe(true);
    expect(isWithinWindow(spec, new Date(2026, 7, 6, 3, 0))).toBe(true);
    expect(isWithinWindow(spec, new Date(2026, 7, 6, 10, 0))).toBe(false);
  });

  it('falls back to safe defaults for unplanned work', () => {
    expect(delegationRunTokens('nothing-planned')).toBe(16_000);
    expect(delegationTimeBudgetMs('nothing-planned')).toBe(300_000);
    expect(delegationTimeoutSeconds('nothing-planned')).toBe(300);
    expect(canDelegate('nothing-planned', new Date()).ok).toBe(true);
  });

  it('snapshots the plan with live consumption', () => {
    recordDelegationConsumption('rd_night', 10_000);
    const snap = delegationSnapshot(new Date(2026, 7, 6, 2, 0)); // night
    expect(snap.entries.length).toBe(DELEGATION_PLAN.length);
    expect(snap.fleetDailyBudget).toBe(fleetDailyBudget());
    expect(snap.totalPlannedPerDay).toBeGreaterThan(0);
    const rd = snap.entries.find((e) => e.slug === 'rd_night');
    expect(rd?.consumed).toBe(10_000);
    expect(rd?.remaining).toBeGreaterThan(0);
  });

  it('exposes a sector on every delegation entry', () => {
    const snap = delegationSnapshot(new Date(2026, 7, 6, 10, 0));
    for (const e of snap.entries) {
      expect(e.sector).toBeDefined();
      expect(e.sector).toBe(sectorFor(e.slug));
    }
  });

  it('sector consumption aggregates across member slugs', () => {
    resetDelegation();
    recordDelegationConsumption('rd_night', 10_000);
    recordDelegationConsumption('dream_cycle', 5_000);
    expect(sectorConsumed('rd')).toBeGreaterThanOrEqual(15_000);
    // ops is untouched
    expect(sectorConsumed('ops')).toBe(0);
  });

  it('canDelegateSector blocks when the sector cap is reached', () => {
    resetDelegation();
    const cap = sectorDailyCap('rd', fleetDailyBudget());
    const noon = new Date(2026, 7, 6, 12, 0);
    expect(canDelegateSector('rd', noon).ok).toBe(true);
    recordDelegationConsumption('rd_night', cap);
    const gate = canDelegateSector('rd', noon);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain('sector "rd"');
  });

  it('canDelegate respects the sector cap (spec budget not enough to matter)', () => {
    resetDelegation();
    const noon = new Date(2026, 7, 6, 12, 0);
    // synthesis_midday lives in the rd sector and its midday window is open at noon.
    expect(canDelegate('synthesis_midday', noon).ok).toBe(true);
    // Exhaust the whole rd sector via another member → blocked even though
    // synthesis_midday's own per-spec budget is untouched.
    const cap = sectorDailyCap('rd', fleetDailyBudget());
    recordDelegationConsumption('dream_cycle', cap);
    const gate = canDelegate('synthesis_midday', noon);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain('corporate cap');
  });

  it('specSector falls back to the corporate slug map', () => {
    const spec = delegationFor('depscan');
    expect(specSector(spec)).toBe('e3-tooling');
    expect(specSector(undefined)).toBe(sectorFor(''));
  });

  it('classifies revenue sectors', () => {
    expect(isRevenueSector('e1-platform')).toBe(true);
    expect(isRevenueSector('e2-b2b')).toBe(true);
    expect(isRevenueSector('ops')).toBe(false);
    expect(isRevenueSector('rd')).toBe(false);
  });
});
