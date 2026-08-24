// ============================================================================
// Command Center — Fleet Controls store (pure unit tests, no network/server)
// ============================================================================
import { describe, expect, it } from 'vitest';
import {
  clampControls,
  defaultControls,
  clampNum,
  resolveBudget,
  resolveCooldownMs,
  isControlsLike,
  controlsFilePath,
} from '@/lib/command-center/controls';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('defaultControls', () => {
  it('matches the current fleet env defaults', () => {
    const d = defaultControls();
    expect(d.repair).toEqual({ cooldownMinutes: 30, maxInCooldown: 3, loopThreshold: 3 });
    expect(d.discovery).toEqual({ enabled: true, intervalMinutes: 30, iterations: 1 });
    expect(d.fleet.dailyBudgetTokens).toBe(5_000_000);
    expect(d.fleet.tiers).toEqual({ free: true, flash: true, pro: true });
    expect(d.updatedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clampControls
// ---------------------------------------------------------------------------

describe('clampControls', () => {
  it('returns defaults for null/undefined input', () => {
    expect(clampControls(undefined)).toEqual(defaultControls());
    expect(clampControls(null)).toEqual(defaultControls());
  });

  it('clamps out-of-bounds values into their ranges', () => {
    const c = clampControls({
      repair: { cooldownMinutes: 99999, maxInCooldown: 999, loopThreshold: -5 },
      discovery: { enabled: true, intervalMinutes: 2, iterations: 99 },
      fleet: { dailyBudgetTokens: 1, tiers: { free: false, flash: true, pro: true } },
    });
    expect(c.repair.cooldownMinutes).toBe(1440);
    expect(c.repair.maxInCooldown).toBe(10);
    expect(c.repair.loopThreshold).toBe(1);
    expect(c.discovery.intervalMinutes).toBe(5);
    expect(c.discovery.iterations).toBe(3);
    expect(c.fleet.dailyBudgetTokens).toBe(100_000);
    expect(c.fleet.tiers.free).toBe(false);
  });

  it('coerces non-finite numbers to defaults', () => {
    const c = clampControls({
      repair: { cooldownMinutes: Number.NaN, maxInCooldown: Number.NaN, loopThreshold: Number.NaN },
      discovery: { intervalMinutes: Number.NaN, iterations: Number.NaN },
      fleet: { dailyBudgetTokens: Number.NaN, tiers: {} },
    });
    const d = defaultControls();
    expect(c.repair.cooldownMinutes).toBe(d.repair.cooldownMinutes);
    expect(c.discovery.intervalMinutes).toBe(d.discovery.intervalMinutes);
    expect(c.fleet.dailyBudgetTokens).toBe(d.fleet.dailyBudgetTokens);
    // boolean fields fall back to defaults
    expect(c.discovery.enabled).toBe(true);
    expect(c.fleet.tiers.free).toBe(true);
  });

  it('merges only provided fields, keeping others at defaults', () => {
    const c = clampControls({ discovery: { intervalMinutes: 60 } });
    expect(c.discovery.intervalMinutes).toBe(60);
    expect(c.repair.cooldownMinutes).toBe(defaultControls().repair.cooldownMinutes);
  });
});

// ---------------------------------------------------------------------------
// clampNum / bounds
// ---------------------------------------------------------------------------

describe('clampNum', () => {
  it('clamps to bounds and rounds', () => {
    expect(clampNum(2.6, 1, 10, 5)).toBe(3);
    expect(clampNum(0, 1, 10, 5)).toBe(1);
    expect(clampNum(50, 1, 10, 5)).toBe(10);
    expect(clampNum(Number.NaN, 1, 10, 5)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// isControlsLike
// ---------------------------------------------------------------------------

describe('isControlsLike', () => {
  it('accepts partial objects and rejects junk', () => {
    expect(isControlsLike({ repair: {} })).toBe(true);
    expect(isControlsLike({ fleet: {} })).toBe(true);
    expect(isControlsLike(null)).toBe(false);
    expect(isControlsLike(42)).toBe(false);
    expect(isControlsLike('x')).toBe(false);
    expect(isControlsLike({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Env resolution helpers
// ---------------------------------------------------------------------------

describe('resolveBudget', () => {
  it('stored > env > default', () => {
    expect(resolveBudget(2_000_000, '1000000', 5_000_000)).toBe(2_000_000);
    expect(resolveBudget(undefined, '3000000', 5_000_000)).toBe(3_000_000);
    expect(resolveBudget(undefined, undefined, 5_000_000)).toBe(5_000_000);
    expect(resolveBudget(0, 'garbage', 5_000_000)).toBe(5_000_000);
  });
});

describe('resolveCooldownMs', () => {
  it('stored minutes (as ms) > env ms > default', () => {
    expect(resolveCooldownMs(15, '300000', 30)).toBe(15 * 60_000);
    expect(resolveCooldownMs(undefined, '600000', 30)).toBe(600_000);
    expect(resolveCooldownMs(undefined, undefined, 30)).toBe(30 * 60_000);
    expect(resolveCooldownMs(undefined, 'bad', 30)).toBe(30 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// Path (defensive)
// ---------------------------------------------------------------------------

describe('controlsFilePath', () => {
  it('returns a controls.json path', () => {
    expect(controlsFilePath().endsWith('controls.json')).toBe(true);
  });
});
