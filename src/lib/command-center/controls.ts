// ============================================================================
// COMMAND CENTER — Fleet Controls (runtime config store)
// ============================================================================
// Single source of truth for the operator's knobs/sliders. Persisted to
// `.draymond/controls.json` (JSON) and consulted by the fleet at call-time via
// `readControlOverrides()` so a saved value beats the process env, which beats
// the built-in default. Pure helpers (defaults, clamping, effective resolution)
// are side-effect free and importable by the vitest suite; fs lives only in the
// read/write entry points.
//
// Precedence everywhere:  stored  >  env  >  default.
// ============================================================================

import fs from "node:fs/promises";
import path from "node:path";
import type { DelegationTier } from "@/lib/draymond/delegation";

// -- Shape --------------------------------------------------------------------

export interface RepairControls {
  /** Repair cooldown window in minutes (env: DRAYMOND_REPAIR_COOLDOWN_MS). */
  cooldownMinutes: number;
  /** Max auto-repairs per signal inside the cooldown before escalation. */
  maxInCooldown: number;
  /** Number of applied repairs that constitutes a "loop" → escalate. */
  loopThreshold: number;
}

export interface DiscoveryControls {
  /** Master switch for the discovery-loop daemon. */
  enabled: boolean;
  /** Cadence in minutes (env: DRAYMOND_DISCOVERY_LOOP_INTERVAL_MS). */
  intervalMinutes: number;
  /** Loop iterations per run (env: DRAYMOND_DISCOVERY_LOOP_ITERATIONS). */
  iterations: number;
}

export interface FleetAggressiveness {
  /** Fleet-wide daily token budget (env: DRAYMOND_FLEET_DAILY_BUDGET). */
  dailyBudgetTokens: number;
  /** Per-tier on/off gates. A disabled tier's work is deprioritized. */
  tiers: Record<Exclude<DelegationTier, 'local' | 'reasoning'>, boolean>;
}

export interface FleetControls {
  repair: RepairControls;
  discovery: DiscoveryControls;
  fleet: FleetAggressiveness;
  /** ISO timestamp of the last persisted write; null when never saved. */
  updatedAt: string | null;
}

// -- Defaults (mirror the env defaults in the fleet readers) -----------------

export function defaultControls(): FleetControls {
  return {
    repair: { cooldownMinutes: 30, maxInCooldown: 3, loopThreshold: 3 },
    discovery: { enabled: true, intervalMinutes: 30, iterations: 1 },
    fleet: { dailyBudgetTokens: 5_000_000, tiers: { free: true, flash: true, pro: true } },
    updatedAt: null,
  };
}

// -- Bounds / clamping (pure) ------------------------------------------------

export const REPAIR_BOUNDS = { cooldownMinutes: [1, 1440], maxInCooldown: [1, 10], loopThreshold: [1, 10] } as const;
export const DISCOVERY_BOUNDS = { intervalMinutes: [5, 480], iterations: [1, 3] } as const;
export const BUDGET_BOUNDS = [100_000, 100_000_000] as const;

/** Clamp a finite number into [min, max]; falls back to `fallback` when NaN. */
export function clampNum(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Round to an integer within bounds; NaN → fallback. */
function int(value: number, [min, max]: readonly [number, number], fallback: number): number {
  return clampNum(value, min, max, fallback);
}

/**
 * Clamp every field of a (possibly partial/malformed) controls object into a
 * valid FleetControls. Missing fields fall back to defaults. Accepts unknown
 * so raw JSON / partial patches are handled defensively. Pure.
 */
export function clampControls(input: unknown): FleetControls {
  const d = defaultControls();
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const repair = (src.repair && typeof src.repair === 'object' ? src.repair : {}) as Record<string, unknown>;
  const discovery = (src.discovery && typeof src.discovery === 'object' ? src.discovery : {}) as Record<string, unknown>;
  const fleet = (src.fleet && typeof src.fleet === 'object' ? src.fleet : {}) as Record<string, unknown>;
  const tiers = (fleet.tiers && typeof fleet.tiers === 'object' ? fleet.tiers : {}) as Record<string, unknown>;

  return {
    repair: {
      cooldownMinutes: int(repair.cooldownMinutes as number, REPAIR_BOUNDS.cooldownMinutes, d.repair.cooldownMinutes),
      maxInCooldown: int(repair.maxInCooldown as number, REPAIR_BOUNDS.maxInCooldown, d.repair.maxInCooldown),
      loopThreshold: int(repair.loopThreshold as number, REPAIR_BOUNDS.loopThreshold, d.repair.loopThreshold),
    },
    discovery: {
      enabled: typeof discovery.enabled === 'boolean' ? discovery.enabled : d.discovery.enabled,
      intervalMinutes: int(discovery.intervalMinutes as number, DISCOVERY_BOUNDS.intervalMinutes, d.discovery.intervalMinutes),
      iterations: int(discovery.iterations as number, DISCOVERY_BOUNDS.iterations, d.discovery.iterations),
    },
    fleet: {
      dailyBudgetTokens: clampNum(
        fleet.dailyBudgetTokens as number,
        BUDGET_BOUNDS[0],
        BUDGET_BOUNDS[1],
        d.fleet.dailyBudgetTokens,
      ),
      tiers: {
        free: typeof tiers.free === 'boolean' ? tiers.free : d.fleet.tiers.free,
        flash: typeof tiers.flash === 'boolean' ? tiers.flash : d.fleet.tiers.flash,
        pro: typeof tiers.pro === 'boolean' ? tiers.pro : d.fleet.tiers.pro,
      },
    },
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : d.updatedAt,
  };
}

/** True when a raw controls payload is structurally recognizable (loose). */
export function isControlsLike(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const o = input as Record<string, unknown>;
  return typeof o.repair === 'object' || typeof o.discovery === 'object' || typeof o.fleet === 'object';
}

// -- Env resolution (pure) ---------------------------------------------------

/**
 * Resolve the effective fleet budget: stored value wins; otherwise the env
 * `DRAYMOND_FLEET_DAILY_BUDGET`; otherwise the default.
 */
export function resolveBudget(stored: number | undefined, envRaw: string | undefined, def = 5_000_000): number {
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored;
  const env = Number(envRaw);
  return Number.isFinite(env) && env > 0 ? env : def;
}

/**
 * Resolve the effective repair cooldown in ms: stored minutes win; otherwise
 * the env `DRAYMOND_REPAIR_COOLDOWN_MS`; otherwise the default minutes.
 */
export function resolveCooldownMs(storedMinutes: number | undefined, envRaw: string | undefined, defMinutes = 30): number {
  if (typeof storedMinutes === 'number' && Number.isFinite(storedMinutes) && storedMinutes > 0) {
    return storedMinutes * 60_000;
  }
  const env = Number(envRaw);
  return Number.isFinite(env) && env > 0 ? env : defMinutes * 60_000;
}

// -- Store path --------------------------------------------------------------

/** Resolve the controls file path (mirrors self-repair's DIR resolution). */
export function controlsFilePath(): string {
  const dir = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond');
  return path.join(dir, 'controls.json');
}

// -- Read / write (fs, best-effort) ------------------------------------------
//
// The fleet readers (`self-repair`, `discovery-loop-daemon`, `delegation`) are
// synchronous and call-time. To wire knobs in without converting every caller
// to async, we keep a module-level in-memory snapshot that the async
// read/write entry points refresh. The sync getters below read the snapshot,
// falling back to env/default. Persistence is async; the runtime sees a saved
// value as soon as the PATCH round-trips through writeControls().

let _snapshot: FleetControls | null = null;

/** Set/clear the in-memory snapshot (used by read/write below). */
export function setControlSnapshot(c: FleetControls | null): void {
  _snapshot = c;
}

/** Current in-memory snapshot (may be null before the first async load). */
export function getControlSnapshot(): FleetControls | null {
  return _snapshot;
}

/**
 * Read persisted controls. Never throws: on any failure returns the clamped
 * defaults. Also refreshes the in-memory snapshot for the sync readers.
 */
export async function readControls(): Promise<FleetControls> {
  try {
    const raw = await fs.readFile(controlsFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const controls = isControlsLike(parsed) ? clampControls(parsed) : defaultControls();
    setControlSnapshot(controls);
    return controls;
  } catch {
    setControlSnapshot(defaultControls());
    return defaultControls();
  }
}

/** Persist clamped controls. Throws on write failure (callers surface the error). */
export async function writeControls(input: Partial<FleetControls>): Promise<FleetControls> {
  const clamped = clampControls({ ...input, updatedAt: new Date().toISOString() });
  await fs.mkdir(path.dirname(controlsFilePath()), { recursive: true });
  await fs.writeFile(controlsFilePath(), JSON.stringify(clamped, null, 2), 'utf-8');
  setControlSnapshot(clamped);
  return clamped;
}

/**
 * Load stored controls for the fleet readers. Returns the clamped stored
 * object (or defaults when absent) WITHOUT throwing — readers stay safe.
 * Also refreshes the snapshot.
 */
export async function readControlOverrides(): Promise<FleetControls> {
  return readControls();
}

// -- Sync getters for the fleet readers --------------------------------------
// Precedence: in-memory snapshot (stored) > env > default. These never throw.

/** Effective fleet daily budget (tokens) for `delegation.fleetDailyBudget`. */
export function syncFleetBudget(envRaw: string | undefined, def = 5_000_000): number {
  const stored = _snapshot?.fleet.dailyBudgetTokens;
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored;
  const env = Number(envRaw);
  return Number.isFinite(env) && env > 0 ? env : def;
}

/** Effective repair cooldown in ms for `self-repair.cooldownMs`. */
export function syncRepairCooldownMs(envRaw: string | undefined, defMinutes = 30): number {
  const stored = _snapshot?.repair.cooldownMinutes;
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored * 60_000;
  const env = Number(envRaw);
  return Number.isFinite(env) && env > 0 ? env : defMinutes * 60_000;
}

/** Effective max auto-repairs in cooldown for `self-repair.maxInCooldown`. */
export function syncRepairMaxInCooldown(envRaw: string | undefined, def = 3): number {
  const stored = _snapshot?.repair.maxInCooldown;
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored;
  const env = Number(envRaw);
  return Number.isFinite(env) && env > 0 ? env : def;
}

/** Effective repair loop window in ms for `self-repair.loopWindowMs`. */
export function syncRepairLoopWindowMs(envRaw: string | undefined, def = 7 * 24 * 60 * 60 * 1000): number {
  const stored = _snapshot?.repair.loopThreshold;
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored * 7 * 24 * 60 * 60 * 1000;
  const env = Number(envRaw);
  return Number.isFinite(env) && env > 0 ? env : def;
}

/** Effective repair loop threshold for `self-repair.loopThreshold`. */
export function syncRepairLoopThreshold(envRaw: string | undefined, def = 3): number {
  const stored = _snapshot?.repair.loopThreshold;
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored;
  const env = Number(envRaw);
  return Number.isFinite(env) && env > 0 ? env : def;
}

/** Effective discovery-loop interval in ms for `discovery-loop-daemon`. */
export function syncDiscoveryIntervalMs(envRaw: string | undefined, def = 30 * 60 * 1000): number {
  const stored = _snapshot?.discovery.intervalMinutes;
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored * 60_000;
  const env = Number(envRaw);
  return Number.isFinite(env) && env > 0 ? env : def;
}

/** Effective discovery-loop iterations for `discovery-loop-daemon`. */
export function syncDiscoveryIterations(envRaw: string | undefined, def = 1): number {
  const stored = _snapshot?.discovery.iterations;
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return Math.min(3, Math.round(stored));
  const env = Number(envRaw);
  return Math.max(1, Math.min(3, Number.isFinite(env) ? Math.round(env) : def));
}

/** Effective discovery-loop daemon enabled flag. */
export function syncDiscoveryEnabled(envRaw: string | undefined, def = true): boolean {
  const stored = _snapshot?.discovery.enabled;
  if (typeof stored === 'boolean') return stored;
  return envRaw !== '0' && def;
}
