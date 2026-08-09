import { describe, expect, it } from 'vitest';
import {
  dayPlan,
  currentPhase,
  DAY_FLOW,
  runPhase,
  estimateStepTokens,
  dayTokenBudget,
} from '../src/lib/draymond/day-orchestrator';
import { financialBrief } from '../src/lib/draymond/data-apis';

describe('day orchestrator', () => {
  it('has a full daily flow across all phases', () => {
    expect(DAY_FLOW.length).toBeGreaterThanOrEqual(12);
    const phases = new Set(DAY_FLOW.map((s) => s.phase));
    expect(phases).toEqual(new Set(['morning', 'midday', 'evening', 'night']));
  });

  it('classifies the current phase and returns the next due step', () => {
    const plan = dayPlan(new Date('2026-08-06T10:00:00Z')); // 10:00 UTC
    expect(plan.phase).toBe('morning');
    expect(plan.nextDue).not.toBeNull();
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('morning phase feeds the financial agents', () => {
    const market = DAY_FLOW.find((s) => s.id === 'market');
    expect(market?.feedsTo).toContain('overlay-treasurer');
    expect(market?.feedsTo).toContain('trading-agents');
    expect(market?.feedsTo).toContain('ghostfolio-engine');
  });

  it('currentPhase maps hours correctly', () => {
    // Construct in LOCAL time so getHours() is deterministic.
    expect(currentPhase(new Date(2026, 7, 6, 7))).toBe('morning');
    expect(currentPhase(new Date(2026, 7, 6, 14))).toBe('midday');
    expect(currentPhase(new Date(2026, 7, 6, 20))).toBe('evening');
    expect(currentPhase(new Date(2026, 7, 6, 2))).toBe('night');
  });

  it('runPhase executes the night group (learning + rd; book scan fail-closes offline)', async () => {
    const result = await runPhase('night');
    // self_learning_loop + rd_night must run; scan_book_library errors cleanly
    // when BookBridge is offline (fail-closed, not a crash).
    expect(result.executed.filter((e) => ['learn', 'rd'].includes(e)).length).toBe(2);
    expect(result.errors.every((e) => e.startsWith('books:'))).toBe(true);
  }, 30_000);

  it('estimates per-step tokens and the full-day budget', () => {
    const budget = dayTokenBudget();
    expect(budget.total).toBeGreaterThan(0);
    expect(Object.keys(budget.byPhase).sort()).toEqual(['evening', 'midday', 'morning', 'night']);
    const market = DAY_FLOW.find((s) => s.id === 'market');
    expect(market).toBeDefined();
    expect(estimateStepTokens(market!)).toBeGreaterThan(0);
  });

  it('runPhase with a tiny token budget drops the whole phase without executing', async () => {
    const result = await runPhase('night', 1);
    expect(result.dropped?.length).toBe(DAY_FLOW.filter((s) => s.phase === 'night').length);
    expect(result.executed).toHaveLength(0);
    expect(result.estimated_tokens).toBe(0);
  }, 30_000);

  it('runPhase without a budget preserves legacy behavior (no dropped field)', async () => {
    const result = await runPhase('evening');
    expect(result.dropped).toBeUndefined();
    expect(result.estimated_tokens).toBeUndefined();
    expect(result.executed[0]).toContain('cron-driven');
  }, 30_000);

  it('night phase includes the cognition steps (dream + ultraplan)', () => {
    const night = DAY_FLOW.filter((s) => s.phase === 'night').map((s) => s.job);
    expect(night).toContain('dream_cycle');
    expect(night).toContain('ultraplan_process');
    const dream = DAY_FLOW.find((s) => s.id === 'dream');
    expect(dream?.time).toBe('02:00');
    const ultraplan = DAY_FLOW.find((s) => s.id === 'ultraplan');
    expect(ultraplan?.time).toBe('02:30');
  });

  it('runPhase night keeps the fail-soft contract with the cognition steps', async () => {
    const result = await runPhase('night');
    // dream/ultraplan handlers never reject (fail-soft by contract) — the only
    // allowed errors are the BookBridge scan failures.
    expect(result.errors.every((e) => e.startsWith('books:'))).toBe(true);
  }, 30_000);
});

describe('financial brief', () => {
  it('produces a brief with crypto data (no key needed)', async () => {
    const brief = await financialBrief();
    expect(brief.crypto.bitcoin).toBeGreaterThan(0);
    expect(brief.brief).toContain('BTC');
  });
});
