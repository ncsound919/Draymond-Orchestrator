// ============================================================================
// DRAYMOND SECTOR LIFECYCLE MANAGER — CPU-friendly on-demand fleet operation
// ============================================================================
// The fleet cannot run ~40 pm2 services at once on one box. This module turns
// the sector model (corporate.ts) into a PROCESS lifecycle: services belong to
// a sector, are classified `warm` (always up) or `on-demand` (cold until a task
// needs them), get touched when a job uses them, and are torn down by an idle
// sweep when their sector goes quiet — so sectors "run and close based on the
// tasks at hand."
//
// Ownership: pm2 is the SINGLE owner of start/stop (see pm2.ts). Draymond
// decides WHEN a sector's services should be warm (scheduler hook); Keywire is
// the authorization/credential seam for anything a service does at runtime.
//
// SAFETY: the automatic idle sweep is OFF unless DRAYMOND_SECTOR_LIFECYCLE=1.
// Manual operator actions (API route) always work. Nothing here ever touches a
// service that is not explicitly declared in the managed table below.
//
// Non-negotiables: deterministic (pure idle math, no LLM), auditable (activity
// persisted to .draymond/service-activity.json, every stop logged), honest
// (services it cannot start are reported, never silently assumed up).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import type { SectorId } from './corporate';
import { sectorById } from './corporate';
import { pm2IsOnline, pm2Stop, pm2StartConfig, pm2List, type Pm2Process } from './pm2';

export type ServiceMode = 'warm' | 'on-demand';

export interface ServiceDef {
  /** pm2 process name (must match the ecosystem.*.config.js app name). */
  slug: string;
  sector: SectorId;
  /** ecosystem config file (relative to ORCH_DIR) used for cold-start. */
  config: string;
  mode: ServiceMode;
  /** Milliseconds a service may sit untouched before the sweep stops it. On-demand only; warm services never sweep. */
  idleTtlMs?: number;
  /** Marks the high-CPU services the whole design exists to reclaim. */
  heavy?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

function orchDir(): string {
  const registry = process.env.DRAYMOND_REGISTRY_DIR;
  if (registry) return path.dirname(registry); // .../<ORCH>/.draymond -> <ORCH>
  return process.cwd();
}

const ORCH = orchDir();

const FLEET = 'ecosystem.fleet.config.js';
const MARKETING = 'ecosystem.marketing.config.js';

/** The always-on core. Nothing here is ever swept, and a task may always rely on it. */
export const WARM_SERVICES: ReadonlySet<string> = new Set([
  'draymond',
  'keywire',
  'deterministic-brain',
  'litellm',
  'cloudflared', // network tunnel — near-zero CPU, must stay for public access
  'smd-redis', // broker — near-zero CPU, smd stack depends on it
  // Research stack — pinned warm 2026-09-08 so the brain-cancer research loop
  // is always answerable. These get swept when their sector idles (on-demand
  // TTL), which silently kills the research app mid-work. The research system
  // is a live commitment; keep it warm.
  'bam',
  'decon-service',
  'recourse',
  'overlay-oncology',
  'omniresearch',
  'comic-engine',
  'global-lens',
]);

/** Optional env flag gates the AUTOMATIC sweep; manual API actions always run. */
export function lifecycleEnabled(): boolean {
  return process.env.DRAYMOND_SECTOR_LIFECYCLE === '1';
}

/** Default idle TTL for a heavy on-demand service before it is reclaimed. */
export const DEFAULT_HEAVY_TTL_MS = 10 * 60 * 1000;
/** Default idle TTL for a light on-demand service. */
export const DEFAULT_LIGHT_TTL_MS = 30 * 60 * 1000;

// ============================================================================
// MANAGED SERVICE TABLE — slug → { sector, config, mode, idleTtl }
// ============================================================================
// Only services declared here are ever started/stopped by the lifecycle
// manager. Sector assignment mirrors corporate.ts SLUG_SECTOR intent for the
// corresponding scheduler handlers.
// ============================================================================

const ttl = (ms: number) => ms;

export const MANAGED_SERVICES: Record<string, ServiceDef> = {
  // ---- E1 Platform ----
  // (commission-engine removed 2026-09-01: no DATABASE_URL configured — cannot start.)

  // ---- E2 B2B / marketing ----
  aetherdesk: { slug: 'aetherdesk', sector: 'e2-b2b', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_HEAVY_TTL_MS), heavy: true },
  smd: { slug: 'smd', sector: 'e2-b2b', config: MARKETING, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  'smd-celery': { slug: 'smd-celery', sector: 'e2-b2b', config: MARKETING, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_HEAVY_TTL_MS), heavy: true },
  'smd-beat': { slug: 'smd-beat', sector: 'e2-b2b', config: MARKETING, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  'smd-browser': { slug: 'smd-browser', sector: 'e2-b2b', config: MARKETING, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_HEAVY_TTL_MS), heavy: true },
  'agent-browser': { slug: 'agent-browser', sector: 'e2-b2b', config: MARKETING, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_HEAVY_TTL_MS), heavy: true },
  // (hermes-brain removed 2026-09-01: gateway launcher fails to boot — cannot start.)
  'hermes-proxy': { slug: 'hermes-proxy', sector: 'e2-b2b', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  'squad-service': { slug: 'squad-service', sector: 'e2-b2b', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  openchat: { slug: 'openchat', sector: 'e2-b2b', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },

  // ---- E3 Tooling / audits / security ----
  'claw-protect': { slug: 'claw-protect', sector: 'e3-tooling', config: MARKETING, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  grader: { slug: 'grader', sector: 'e3-tooling', config: MARKETING, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  reporank: { slug: 'reporank', sector: 'e3-tooling', config: MARKETING, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  mutly: { slug: 'mutly', sector: 'e3-tooling', config: MARKETING, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  // (vibe-reality removed 2026-09-01: port 3202 held by a native process — pm2 cannot own it.)
  'big-homie': { slug: 'big-homie', sector: 'e3-tooling', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  'system-agent': { slug: 'system-agent', sector: 'e3-tooling', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  // (dev-brain removed 2026-09-01: overlaps deterministic-brain, no longer in fleet roster.)
  // (halofy removed 2026-09-01: missing DB config, vendored clone — cannot start.)
  eidos: { slug: 'eidos', sector: 'e3-tooling', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  // (buzz-relay removed 2026-09-01: vendored, not in fleet roster.)
  // (rome removed 2026-09-01: vendored, not in fleet roster.)

  // ---- E4 Vertical products ----
  'global-lens': { slug: 'global-lens', sector: 'e4-vertical', config: FLEET, mode: 'warm' },
  'comic-engine': { slug: 'comic-engine', sector: 'e4-vertical', config: FLEET, mode: 'warm' },
  omniresearch: { slug: 'omniresearch', sector: 'e4-vertical', config: FLEET, mode: 'warm' },
  // Re-added 2026-09-01: now pm2-owned (port 8777) and job-driven — sweepable.
  bookbridge: { slug: 'bookbridge', sector: 'e4-vertical', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_HEAVY_TTL_MS), heavy: true },
  'overlay-oncology': { slug: 'overlay-oncology', sector: 'e4-vertical', config: FLEET, mode: 'warm' },
  'bbtech-web-app': { slug: 'bbtech-web-app', sector: 'e4-vertical', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  'indy-music': { slug: 'indy-music', sector: 'e4-vertical', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  'overlay-chain': { slug: 'overlay-chain', sector: 'e4-vertical', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  'hemp-os': { slug: 'hemp-os', sector: 'e4-vertical', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  // Re-added 2026-09-01: now pm2-owned (port 8000) and job-driven — sweepable.
  'uplift-agent': { slug: 'uplift-agent', sector: 'e4-vertical', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_LIGHT_TTL_MS) },
  'sub-team': { slug: 'sub-team', sector: 'e4-vertical', config: FLEET, mode: 'on-demand', idleTtlMs: ttl(DEFAULT_HEAVY_TTL_MS), heavy: true },

  // ---- Research engines (pinned warm 2026-09-08) ----
  // BAM/CureMind (port 3002), Decon (8070), Recourse (3050) are the brain-cancer
  // research engines. They were previously NOT in the managed table — the
  // lifecycle neither protected them nor knew their configs. Added warm so the
  // sweep never reclaims the research stack.
  bam: { slug: 'bam', sector: 'e4-vertical', config: 'ecosystem.bam.config.js', mode: 'warm' },
  'decon-service': { slug: 'decon-service', sector: 'e4-vertical', config: '../02_Pillars/Overlay Science/Overlay Oncology/components/Decon/service/ecosystem.config.cjs', mode: 'warm' },
  recourse: { slug: 'recourse', sector: 'e4-vertical', config: 'ecosystem.fleet.config.js', mode: 'warm' },

  // ---- Ops infra (not warm, but storable on-demand) ----
  // (opencode removed 2026-09-01: headless serve crash-looped 105k+ restarts — needs config fix first.)
  // (dsh-harness removed 2026-09-01: cut from the fleet (CPU hog, overlaps litellm).)
};

// ============================================================================
// ACTIVITY TRACKING (persisted) — "last used" per service
// ============================================================================

interface ActivityState {
  lastUsed: Record<string, string>; // slug -> ISO timestamp
}

function activityPath(): string {
  return path.join(ORCH, '.draymond', 'service-activity.json');
}

let _activity: ActivityState | null = null;

function loadActivity(): ActivityState {
  if (_activity) return _activity;
  try {
    const raw = fs.readFileSync(activityPath(), 'utf8');
    const parsed = JSON.parse(raw) as ActivityState;
    _activity = { lastUsed: parsed?.lastUsed ?? {} };
  } catch {
    _activity = { lastUsed: {} };
  }
  return _activity;
}

function persistActivity(): void {
  try {
    fs.mkdirSync(path.dirname(activityPath()), { recursive: true });
    fs.writeFileSync(activityPath(), JSON.stringify(_activity, null, 2), 'utf8');
  } catch {
    // best-effort; in-memory state still drives this process
  }
}

/** Mark a service as just-used (its idle clock resets). */
export function touchService(slug: string, now = new Date()): void {
  if (!(slug in MANAGED_SERVICES)) return;
  const state = loadActivity();
  state.lastUsed[slug] = now.toISOString();
  persistActivity();
}

/** Mark every service in a sector as just-used. */
export function touchSector(sector: SectorId, now = new Date()): void {
  for (const def of Object.values(MANAGED_SERVICES)) {
    if (def.sector === sector) touchService(def.slug, now);
  }
}

/**
 * Ensure every managed service in a sector is up before a job for that sector
 * runs, then mark the whole sector as just-used. On-demand services are
 * cold-started via pm2 (config-driven); warm services already up are touched.
 *
 * This is the "turn a sector on when its work needs it" half of the lifecycle.
 * The idle sweep (sectorSweep) is the "turn it back off when done" half.
 * Returns a per-service report so the caller can log which started/failed.
 */
export async function ensureSectorForJob(
  sector: SectorId,
  now = new Date(),
): Promise<{ touched: string[]; started: string[]; failed: string[]; disabled: boolean }> {
  const touched: string[] = [];
  const started: string[] = [];
  const failed: string[] = [];
  const on = lifecycleEnabled();

  for (const def of Object.values(MANAGED_SERVICES)) {
    if (def.sector !== sector) continue;
    if (isWarm(def.slug)) {
      touchService(def.slug, now);
      touched.push(def.slug);
      continue;
    }
    // On-demand service: cold-start only when the lifecycle is enabled.
    if (!on) {
      // Still mark warm/up services used so a manual sweep never reaps them
      // mid-task; disabled mode simply never cold-starts.
      touchService(def.slug, now);
      touched.push(def.slug);
      continue;
    }
    const result = await ensureServiceForTask(def.slug);
    if (result === 'started') started.push(def.slug);
    else if (result === 'failed') failed.push(def.slug);
    else touched.push(def.slug); // 'up' | 'noop' | 'disabled' — leave the clock as-is
  }
  return { touched, started, failed, disabled: !on };
}

function lastUsedIso(slug: string): string | undefined {
  return loadActivity().lastUsed[slug];
}

// ============================================================================
// PURE HELPERS (unit-testable, no I/O)
// ============================================================================

export function getServiceDef(slug: string): ServiceDef | undefined {
  return MANAGED_SERVICES[slug];
}

export function isWarm(slug: string): boolean {
  return WARM_SERVICES.has(slug);
}

export function serviceSector(slug: string): SectorId {
  return MANAGED_SERVICES[slug]?.sector ?? 'ops';
}

/** How long (ms) a service has been idle, or null if never touched/unknown. */
export function serviceIdleMs(slug: string, now = new Date()): number | null {
  const iso = lastUsedIso(slug);
  if (!iso) return null; // never touched — treat as idle-eligible only via explicit policy
  const used = Date.parse(iso);
  if (Number.isNaN(used)) return null;
  return Math.max(0, now.getTime() - used);
}

/** Pure decision: should this on-demand service be stopped at `now`? */
export function shouldStopService(slug: string, now = new Date()): boolean {
  const def = getServiceDef(slug);
  if (!def || def.mode === 'warm' || isWarm(slug)) return false;
  const idle = serviceIdleMs(slug, now);
  // Never-touched services are idle-eligible when the lifecycle is ON: anything
  // not actively used by a job gets reclaimed, so the fleet only runs what the
  // current work needs. When the lifecycle is OFF (safety mode), never-touched
  // services are protected (legacy behaviour).
  if (idle === null) return lifecycleEnabled();
  return idle >= (def.idleTtlMs ?? DEFAULT_LIGHT_TTL_MS);
}

/** Sector membership summary for observability (no I/O). */
export function sectorServiceCounts(): Record<SectorId, { total: number; onDemand: number; heavy: number }> {
  const out = {} as Record<SectorId, { total: number; onDemand: number; heavy: number }>;
  for (const s of ['e1-platform', 'e2-b2b', 'e3-tooling', 'e4-vertical', 'ops', 'rd'] as SectorId[]) {
    out[s] = { total: 0, onDemand: 0, heavy: 0 };
  }
  for (const def of Object.values(MANAGED_SERVICES)) {
    const c = out[def.sector];
    c.total += 1;
    if (def.mode === 'on-demand') c.onDemand += 1;
    if (def.heavy) c.heavy += 1;
  }
  return out;
}

// ============================================================================
// LIFECYCLE ACTIONS (I/O — start/stop via pm2)
// ============================================================================

export type EnsureResult = 'up' | 'started' | 'noop' | 'failed' | 'disabled';

/**
 * Ensure a managed service is up before a task uses it. Warm services are
 * always treated as required; on-demand services are cold-started on demand.
 */
export async function ensureServiceForTask(slug: string): Promise<EnsureResult> {
  const def = getServiceDef(slug);
  if (!def) return 'noop'; // not managed — leave it alone

  if (await pm2IsOnline(slug)) {
    touchService(slug);
    return 'up';
  }

  // Warm service down is an anomaly — attempt to bring it back.
  if (isWarm(slug)) {
    const started = await pm2StartConfig(/*turbopackIgnore: true*/ path.join(ORCH, def.config), slug);
    if (!started) return 'failed';
    touchService(slug);
    return 'started';
  }

  // On-demand: cold-start only when the operator has enabled the lifecycle.
  if (!lifecycleEnabled()) return 'disabled';
  const started = await pm2StartConfig(/*turbopackIgnore: true*/ path.join(ORCH, def.config), slug);
  if (!started) return 'failed';
  touchService(slug);
  return 'started';
}

/** Stop a managed service (sticky via pm2). Warm services are protected. */
export async function stopService(slug: string): Promise<'stopped' | 'not-managed' | 'warm-protected' | 'not-running' | 'failed'> {
  const def = getServiceDef(slug);
  if (!def) return 'not-managed';
  if (isWarm(slug) || def.mode === 'warm') return 'warm-protected';
  if (!(await pm2IsOnline(slug))) return 'not-running';
  const ok = await pm2Stop(slug);
  return ok ? 'stopped' : 'failed';
}

/** Stop a single on-demand service if it has been idle past its TTL. */
export async function stopServiceIfIdle(slug: string, now = new Date()): Promise<boolean> {
  if (!shouldStopService(slug, now)) return false;
  const res = await stopService(slug);
  return res === 'stopped';
}

/**
 * The idle sweep: stop every managed on-demand service that is up but idle past
 * its TTL. Never touches warm services. Returns what was stopped vs kept.
 */
export async function sectorSweep(now = new Date()): Promise<{ stopped: string[]; kept: string[]; failed: string[] }> {
  const stopped: string[] = [];
  const kept: string[] = [];
  const failed: string[] = [];
  const list: Map<string, Pm2Process> = await pm2List();

  for (const slug of Object.keys(MANAGED_SERVICES)) {
    const def = getServiceDef(slug)!;
    if (def.mode === 'warm' || isWarm(slug)) continue;
    const proc = list.get(slug);
    if (!proc || proc.status !== 'online') continue; // already down — nothing to do
    if (!shouldStopService(slug, now)) {
      kept.push(slug);
      continue;
    }
    const ok = await pm2Stop(slug);
    if (ok) stopped.push(slug);
    else failed.push(slug);
  }
  return { stopped, kept, failed };
}

// ============================================================================
// OBSERVABILITY
// ============================================================================

export interface LifecycleServiceState {
  slug: string;
  sector: SectorId;
  mode: ServiceMode;
  heavy: boolean;
  idleTtlMs: number | null;
  lastUsed: string | null;
  idleMs: number | null;
  stopDue: boolean;
}

export interface LifecycleState {
  enabled: boolean;
  warm: string[];
  services: LifecycleServiceState[];
  sectorCounts: ReturnType<typeof sectorServiceCounts>;
}

/** Deterministic snapshot for the ops dashboard (no I/O). */
export function sectorState(now = new Date()): LifecycleState {
  const services: LifecycleServiceState[] = Object.values(MANAGED_SERVICES).map((def) => {
    const idle = serviceIdleMs(def.slug, now);
    return {
      slug: def.slug,
      sector: def.sector,
      mode: def.mode,
      heavy: !!def.heavy,
      idleTtlMs: def.idleTtlMs ?? (def.mode === 'warm' ? null : DEFAULT_LIGHT_TTL_MS),
      lastUsed: lastUsedIso(def.slug) ?? null,
      idleMs: idle,
      stopDue: shouldStopService(def.slug, now),
    };
  });
  return {
    enabled: lifecycleEnabled(),
    warm: [...WARM_SERVICES].sort(),
    services,
    sectorCounts: sectorServiceCounts(),
  };
}

export function describeSector(sector: SectorId): string {
  return sectorById(sector).name;
}
