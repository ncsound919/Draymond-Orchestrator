// ============================================================================
import { writeBrainFile } from './journal';

// DRAYMOND ORCHESTRATION SYSTEM — Delegation Plan
// ============================================================================
// Single source of truth for HOW the fleet is delegated: which component
// (handler / agent / chain) runs at what time of day, for how long, and with
// what token budget.
//
// Optimisation model (balancing throughput vs cost):
//   - Every component has a time-of-day window (when it is allowed to run).
//   - Every component has a time budget (max duration per run) so heavy work
//     can't starve the rest of the fleet.
//   - Every component has a per-run token budget and a per-day cap so a single
//     agent can't blow the fleet allowance.
//   - The whole fleet sits under a shared DAILY token cap (default 5M/day).
//
// Deterministic + in-memory (consumption resets on restart; budgets are
// deliberately conservative). Runtime enforcement lives in workflow-budget.ts
// (fleet cap), day-orchestrator.ts (phase budget), and scheduler.ts (timeouts).
// ============================================================================

import { syncFleetBudget } from "@/lib/command-center/controls";
import {
  sectorFor,
  sectorDailyCap,
  sectorMemberSlugs,
  REVENUE_SECTOR_IDS,
  type SectorId,
} from './corporate';

export type DelegationTier = 'free' | 'local' | 'flash' | 'pro' | 'reasoning';

export type DelegationPhase = 'morning' | 'midday' | 'evening' | 'night';

export type DelegationDuty = 'always-on' | 'shift' | 'on-call' | 'night';

export interface DelegationWindow {
  /** Local start time "HH:MM". */
  start: string;
  /** Local end time "HH:MM" (exclusive). Overnight windows supported (end <= start). */
  end: string;
  /** Days active: 1=Mon .. 7=Sun. Empty = every day. */
  days?: number[];
}

export interface DelegationSpec {
  /** Entity slug / handler name this delegation applies to. */
  slug: string;
  /** Human label for dashboards. */
  label: string;
  /** Which corporate sector / division this component belongs to. */
  sector?: SectorId;
  /** Which day phase the work belongs to. */
  phase: DelegationPhase;
  /** Time-of-day window; defaults to the phase's window when omitted. */
  window?: DelegationWindow;
  /** Max duration for a single run (ms). */
  timeBudgetMs: number;
  /** Estimated tokens for a single run (context + output). */
  tokenBudgetPerRun: number;
  /** Max tokens this component may consume per day. */
  tokenBudgetPerDay: number;
  /** Preferred model tier (routing hint, not a hard constraint). */
  tier: DelegationTier;
  /** 1 = critical, 2 = standard, 3 = best-effort. */
  priority: 1 | 2 | 3;
  /** Duty class — mirrors fleet-duty.ts. */
  duty: DelegationDuty;
}

// ============================================================================
// FLEET DAILY BUDGET
// ============================================================================

/** Fleet-wide daily token cap — the whole ecosystem stays under this. */
export function fleetDailyBudget(): number {
  return syncFleetBudget(process.env.DRAYMOND_FLEET_DAILY_BUDGET);
}

/** Fraction of the fleet daily budget reserved for each phase. */
export const PHASE_WEIGHT: Record<DelegationPhase, number> = {
  morning: 0.3,
  midday: 0.2,
  evening: 0.15,
  night: 0.35,
};

/** Token budget slice reserved for a whole day phase. */
export function phaseBudget(phase: DelegationPhase): number {
  return Math.round(fleetDailyBudget() * (PHASE_WEIGHT[phase] ?? 0.2));
}

// ============================================================================
// DEFAULT WINDOWS PER PHASE
// ============================================================================

const PHASE_WINDOW: Record<DelegationPhase, DelegationWindow> = {
  morning: { start: '05:00', end: '12:00' },
  midday: { start: '12:00', end: '17:00' },
  evening: { start: '17:00', end: '22:00' },
  night: { start: '22:00', end: '05:00' },
};

// ============================================================================
// THE DELEGATION PLAN
// ============================================================================
// Balanced-throughput allocation: cheap health checks run all day, business
// critical work (treasury, mission, marketing) owns the morning, benchmarks
// and deep analysis run midday, and expensive research/dev work is deferred to
// the night when paid tier headroom is quiet.
// ============================================================================

export const DELEGATION_PLAN: DelegationSpec[] = [
  // ── Draymond core — always-on, cheapest tier ────────────────────────────
  { slug: 'draymond', label: 'Draymond core', phase: 'morning', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 60_000, tokenBudgetPerRun: 8_000, tokenBudgetPerDay: 200_000, tier: 'free', priority: 1, duty: 'always-on' },
  { slug: 'brain_decision_cycle', label: 'Brain decision cycle', phase: 'midday', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 120_000, tokenBudgetPerRun: 24_000, tokenBudgetPerDay: 120_000, tier: 'free', priority: 1, duty: 'always-on' },
  { slug: 'agent_heartbeat_sweep', label: 'Agent heartbeat sweep', phase: 'morning', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 30_000, tokenBudgetPerRun: 4_000, tokenBudgetPerDay: 40_000, tier: 'free', priority: 2, duty: 'always-on' },
  { slug: 'service_health_repair', label: 'Service health repair', phase: 'morning', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 60_000, tokenBudgetPerRun: 8_000, tokenBudgetPerDay: 60_000, tier: 'free', priority: 1, duty: 'always-on' },
  { slug: 'self_repair_check', label: 'Self-repair check', phase: 'midday', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 90_000, tokenBudgetPerRun: 16_000, tokenBudgetPerDay: 120_000, tier: 'flash', priority: 1, duty: 'always-on' },
  { slug: 'repair_failed_jobs', label: 'Repair team', phase: 'midday', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 600_000, tokenBudgetPerRun: 80_000, tokenBudgetPerDay: 300_000, tier: 'flash', priority: 1, duty: 'always-on' },
  { slug: 'kairos_scan', label: 'Kairos proactive scan', phase: 'midday', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 120_000, tokenBudgetPerRun: 24_000, tokenBudgetPerDay: 150_000, tier: 'free', priority: 1, duty: 'always-on' },

  // ── Business — morning, higher priority ─────────────────────────────────
  { slug: 'ingest_news', label: 'News digest ingest', phase: 'morning', timeBudgetMs: 120_000, tokenBudgetPerRun: 24_000, tokenBudgetPerDay: 24_000, tier: 'free', priority: 2, duty: 'always-on' },
  { slug: 'fetch_market_data', label: 'Market data snapshot', phase: 'morning', timeBudgetMs: 90_000, tokenBudgetPerRun: 16_000, tokenBudgetPerDay: 16_000, tier: 'free', priority: 2, duty: 'always-on' },
  { slug: 'run_overlay_qa', label: 'Overlay365 QA pass', phase: 'morning', timeBudgetMs: 600_000, tokenBudgetPerRun: 64_000, tokenBudgetPerDay: 64_000, tier: 'free', priority: 2, duty: 'shift' },
  { slug: 'treasury_pulse', label: 'Treasurer cash pulse', phase: 'morning', timeBudgetMs: 180_000, tokenBudgetPerRun: 32_000, tokenBudgetPerDay: 32_000, tier: 'flash', priority: 1, duty: 'always-on' },
  { slug: 'mission_pipeline_sync', label: 'Mission pipeline sync', phase: 'morning', timeBudgetMs: 300_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 48_000, tier: 'flash', priority: 1, duty: 'always-on' },
  { slug: 'mission_strategy_review', label: 'Mission strategy review', phase: 'morning', timeBudgetMs: 300_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 96_000, tier: 'pro', priority: 1, duty: 'always-on' },
  { slug: 'mission_run_maas_cycle', label: 'MaaS monthly cycle', phase: 'morning', timeBudgetMs: 900_000, tokenBudgetPerRun: 120_000, tokenBudgetPerDay: 240_000, tier: 'pro', priority: 1, duty: 'shift' },
  { slug: 'dispatch_worker_tasks', label: 'On-device ops dispatch', phase: 'morning', timeBudgetMs: 60_000, tokenBudgetPerRun: 8_000, tokenBudgetPerDay: 16_000, tier: 'free', priority: 2, duty: 'shift' },
  { slug: 'phase_recap', label: 'Phase recap (workplace)', phase: 'evening', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 120_000, tokenBudgetPerRun: 24_000, tokenBudgetPerDay: 72_000, tier: 'flash', priority: 1, duty: 'always-on' },
  { slug: 'evening_call_recap', label: 'Evening call recap', phase: 'evening', timeBudgetMs: 90_000, tokenBudgetPerRun: 16_000, tokenBudgetPerDay: 16_000, tier: 'flash', priority: 2, duty: 'shift' },
  { slug: 'marketing-pulse', label: 'Marketing pulse', phase: 'morning', timeBudgetMs: 600_000, tokenBudgetPerRun: 64_000, tokenBudgetPerDay: 96_000, tier: 'flash', priority: 2, duty: 'shift' },
  { slug: 'oss_marketing_stack', label: 'OSS marketing stack (Shlink/Postiz/Listmonk/Twenty/Formbricks)', phase: 'morning', timeBudgetMs: 180_000, tokenBudgetPerRun: 4_000, tokenBudgetPerDay: 12_000, tier: 'free', priority: 2, duty: 'shift' },
  { slug: 'strategy_team', label: 'Strategy team (Overlay Strategist scan/report)', phase: 'morning', timeBudgetMs: 120_000, tokenBudgetPerRun: 24_000, tokenBudgetPerDay: 96_000, tier: 'flash', priority: 1, duty: 'shift' },
  { slug: 'social-media-dashboard', label: 'Social media dashboard', phase: 'midday', window: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] }, timeBudgetMs: 900_000, tokenBudgetPerRun: 64_000, tokenBudgetPerDay: 160_000, tier: 'flash', priority: 2, duty: 'shift' },
  { slug: 'aetherdesk', label: 'Aetherdesk call center', phase: 'midday', window: { start: '09:00', end: '17:00' }, timeBudgetMs: 600_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 120_000, tier: 'flash', priority: 2, duty: 'shift' },

  // ── Trading / finance — market hours ────────────────────────────────────
  { slug: 'trading-agents', label: 'TradingAgents (+ super-tool risk engine)', phase: 'midday', window: { start: '09:30', end: '16:00', days: [1, 2, 3, 4, 5] }, timeBudgetMs: 1_500_000, tokenBudgetPerRun: 120_000, tokenBudgetPerDay: 320_000, tier: 'pro', priority: 1, duty: 'shift' },
  { slug: 'ghostfolio-engine', label: 'Ghostfolio wealth engine', phase: 'morning', timeBudgetMs: 300_000, tokenBudgetPerRun: 32_000, tokenBudgetPerDay: 64_000, tier: 'flash', priority: 2, duty: 'always-on' },
  { slug: 'overlay-treasurer', label: 'Overlay treasurer', phase: 'morning', timeBudgetMs: 300_000, tokenBudgetPerRun: 32_000, tokenBudgetPerDay: 64_000, tier: 'flash', priority: 1, duty: 'always-on' },
  { slug: 'litellm', label: 'LiteLLM gateway (+ tap919 middleware, llmlingua)', phase: 'morning', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 60_000, tokenBudgetPerRun: 8_000, tokenBudgetPerDay: 40_000, tier: 'free', priority: 1, duty: 'always-on' },
  { slug: 'deterministic-brain', label: 'Deterministic brain', phase: 'midday', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 120_000, tokenBudgetPerRun: 24_000, tokenBudgetPerDay: 120_000, tier: 'free', priority: 1, duty: 'always-on' },

  // ── Sports — daily + events ─────────────────────────────────────────────
  { slug: 'sports-steve', label: 'Sports Steve', phase: 'morning', window: { start: '06:00', end: '23:00' }, timeBudgetMs: 600_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 160_000, tier: 'flash', priority: 2, duty: 'shift' },
  { slug: 'editorial_push', label: 'Editorial morning push', phase: 'morning', timeBudgetMs: 300_000, tokenBudgetPerRun: 32_000, tokenBudgetPerDay: 32_000, tier: 'flash', priority: 2, duty: 'shift' },
  { slug: 'sports-betting-daily', label: 'Sports betting daily', phase: 'morning', timeBudgetMs: 600_000, tokenBudgetPerRun: 64_000, tokenBudgetPerDay: 64_000, tier: 'flash', priority: 2, duty: 'shift' },

  // ── Science / research — deep work at night ─────────────────────────────
  { slug: 'omniresearch-pro', label: 'OmniResearch Pro (+ open-notebook)', phase: 'night', window: { start: '20:00', end: '06:00' }, timeBudgetMs: 1_800_000, tokenBudgetPerRun: 120_000, tokenBudgetPerDay: 300_000, tier: 'pro', priority: 2, duty: 'night' },
  { slug: 'bookbridge', label: 'BookBridge (+ synthesis, zvec, memagent)', phase: 'night', window: { start: '00:00', end: '06:00' }, timeBudgetMs: 600_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 96_000, tier: 'flash', priority: 2, duty: 'night' },
  { slug: 'generative-video-ai', label: 'Generative Video AI (+ shorts, content engine)', phase: 'midday', window: { start: '10:00', end: '20:00' }, timeBudgetMs: 900_000, tokenBudgetPerRun: 64_000, tokenBudgetPerDay: 160_000, tier: 'flash', priority: 2, duty: 'always-on' },
  { slug: 'agent-browser', label: 'AgentBrowser web pipeline (+ browser-use, scrapling)', phase: 'midday', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 600_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 120_000, tier: 'flash', priority: 2, duty: 'always-on' },
  { slug: 'ufc-mcp', label: 'File conversion pipeline (+ stirling-pdf)', phase: 'evening', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 300_000, tokenBudgetPerRun: 24_000, tokenBudgetPerDay: 48_000, tier: 'free', priority: 2, duty: 'always-on' },
  { slug: 'phoenix', label: 'Phoenix observability', phase: 'midday', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 120_000, tokenBudgetPerRun: 16_000, tokenBudgetPerDay: 48_000, tier: 'free', priority: 2, duty: 'always-on' },
  { slug: 'rd_night', label: 'Night mode R&D', phase: 'night', timeBudgetMs: 1_200_000, tokenBudgetPerRun: 96_000, tokenBudgetPerDay: 96_000, tier: 'pro', priority: 2, duty: 'night' },
  { slug: 'dream_cycle', label: 'Dream cycle', phase: 'night', timeBudgetMs: 600_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 48_000, tier: 'flash', priority: 2, duty: 'night' },
  { slug: 'ultraplan_process', label: 'Ultraplan process', phase: 'night', timeBudgetMs: 900_000, tokenBudgetPerRun: 64_000, tokenBudgetPerDay: 64_000, tier: 'pro', priority: 2, duty: 'night' },
  { slug: 'scan_book_library', label: 'Book library scan', phase: 'night', timeBudgetMs: 600_000, tokenBudgetPerRun: 24_000, tokenBudgetPerDay: 24_000, tier: 'free', priority: 3, duty: 'night' },
  { slug: 'wiki_sync', label: 'Brain wiki sync', phase: 'night', timeBudgetMs: 120_000, tokenBudgetPerRun: 8_000, tokenBudgetPerDay: 8_000, tier: 'free', priority: 3, duty: 'night' },
  { slug: 'systemic_consolidate', label: 'Systemic consolidation', phase: 'night', timeBudgetMs: 600_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 48_000, tier: 'flash', priority: 2, duty: 'night' },
  { slug: 'systemic_interconnect', label: 'Systemic interconnect', phase: 'night', window: { start: '00:00', end: '06:00', days: [7] }, timeBudgetMs: 1_200_000, tokenBudgetPerRun: 96_000, tokenBudgetPerDay: 96_000, tier: 'pro', priority: 2, duty: 'night' },
  { slug: 'self_learning_loop', label: 'Self-learning loop', phase: 'night', timeBudgetMs: 300_000, tokenBudgetPerRun: 32_000, tokenBudgetPerDay: 32_000, tier: 'flash', priority: 2, duty: 'night' },
  { slug: 'synthesis_midday', label: 'Synthesis midday check', phase: 'midday', timeBudgetMs: 300_000, tokenBudgetPerRun: 32_000, tokenBudgetPerDay: 64_000, tier: 'flash', priority: 2, duty: 'always-on' },
  { slug: 'clinvar_surveillance', label: 'ClinVar variant surveillance', phase: 'morning', timeBudgetMs: 120_000, tokenBudgetPerRun: 16_000, tokenBudgetPerDay: 16_000, tier: 'flash', priority: 3, duty: 'always-on' },

  // ── Benchmarks / audits — midday, compressed ────────────────────────────
  { slug: 'benchmark_roster', label: 'Roster benchmark', phase: 'morning', timeBudgetMs: 900_000, tokenBudgetPerRun: 96_000, tokenBudgetPerDay: 96_000, tier: 'flash', priority: 2, duty: 'always-on' },
  { slug: 'benchmark_entities', label: 'Benchmark: entities', phase: 'midday', timeBudgetMs: 600_000, tokenBudgetPerRun: 64_000, tokenBudgetPerDay: 64_000, tier: 'flash', priority: 3, duty: 'always-on' },
  { slug: 'benchmark_sites', label: 'Benchmark: sites', phase: 'midday', timeBudgetMs: 600_000, tokenBudgetPerRun: 64_000, tokenBudgetPerDay: 64_000, tier: 'flash', priority: 3, duty: 'always-on' },
  { slug: 'benchmark_crons', label: 'Benchmark: crons', phase: 'midday', timeBudgetMs: 600_000, tokenBudgetPerRun: 64_000, tokenBudgetPerDay: 64_000, tier: 'flash', priority: 3, duty: 'always-on' },
  { slug: 'benchmark_chains', label: 'Benchmark: chains', phase: 'midday', timeBudgetMs: 600_000, tokenBudgetPerRun: 64_000, tokenBudgetPerDay: 64_000, tier: 'flash', priority: 3, duty: 'always-on' },
  { slug: 'benchmark_deep_score', label: 'Benchmark: deep score', phase: 'midday', window: { start: '12:00', end: '20:00', days: [4] }, timeBudgetMs: 1_800_000, tokenBudgetPerRun: 120_000, tokenBudgetPerDay: 240_000, tier: 'pro', priority: 2, duty: 'always-on' },
  { slug: 'benchmark_upgrade_review', label: 'Upgrade review', phase: 'midday', window: { start: '08:00', end: '18:00', days: [6] }, timeBudgetMs: 600_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 48_000, tier: 'flash', priority: 3, duty: 'always-on' },
  { slug: 'rotate_tokens', label: 'Token rotation check', phase: 'midday', window: { start: '08:00', end: '18:00' }, timeBudgetMs: 60_000, tokenBudgetPerRun: 8_000, tokenBudgetPerDay: 8_000, tier: 'free', priority: 2, duty: 'always-on' },
  { slug: 'api_key_audit', label: 'Free-API key audit', phase: 'morning', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 60_000, tokenBudgetPerRun: 8_000, tokenBudgetPerDay: 8_000, tier: 'free', priority: 3, duty: 'always-on' },
  { slug: 'code_review_check', label: 'Code review scan', phase: 'midday', timeBudgetMs: 300_000, tokenBudgetPerRun: 32_000, tokenBudgetPerDay: 32_000, tier: 'flash', priority: 3, duty: 'always-on' },

  // ── Security — Monday morning ───────────────────────────────────────────
  { slug: 'depscan', label: 'Dep-scan (+ supply-chain health)', phase: 'morning', window: { start: '05:00', end: '10:00', days: [1] }, timeBudgetMs: 900_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 80_000, tier: 'free', priority: 1, duty: 'always-on' },
  { slug: 'nuclei-scanner', label: 'Nuclei scanner', phase: 'morning', window: { start: '05:00', end: '10:00', days: [1] }, timeBudgetMs: 900_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 48_000, tier: 'free', priority: 1, duty: 'always-on' },
  { slug: 'overlay-auditor', label: 'Overlay auditor', phase: 'morning', timeBudgetMs: 600_000, tokenBudgetPerRun: 48_000, tokenBudgetPerDay: 96_000, tier: 'flash', priority: 1, duty: 'always-on' },
  { slug: 'overlay-guardian', label: 'Overlay guardian', phase: 'evening', timeBudgetMs: 300_000, tokenBudgetPerRun: 32_000, tokenBudgetPerDay: 64_000, tier: 'flash', priority: 1, duty: 'on-call' },
  { slug: 'claw-protect', label: 'Claw-Protect', phase: 'midday', window: { start: '00:00', end: '23:59' }, timeBudgetMs: 300_000, tokenBudgetPerRun: 24_000, tokenBudgetPerDay: 48_000, tier: 'free', priority: 1, duty: 'always-on' },
];

const PLAN_BY_SLUG = new Map(DELEGATION_PLAN.map((s) => [s.slug, s]));

/** Look up a delegation spec by slug; undefined when not in the plan. */
export function delegationFor(slug: string): DelegationSpec | undefined {
  return PLAN_BY_SLUG.get(slug);
}

/** Sector for a spec (explicit field wins, else the corporate slug map). */
export function specSector(spec: DelegationSpec | undefined): SectorId {
  return spec?.sector ?? sectorFor(spec?.slug ?? '');
}

/** Effective time-of-day window for a spec (explicit window or phase default). */
export function delegationWindow(slug: string): DelegationWindow {
  const spec = PLAN_BY_SLUG.get(slug);
  return spec?.window ?? PHASE_WINDOW[spec?.phase ?? 'midday'];
}

/** Day number (1=Mon .. 7=Sun) for a date in local time. */
export function localDayNumber(now: Date): number {
  const dow = now.getDay(); // 0=Sun
  return dow === 0 ? 7 : dow;
}

/** True when `now` falls inside the spec's time-of-day window (local time). */
export function isWithinWindow(spec: DelegationSpec, now: Date): boolean {
  const window = spec.window ?? PHASE_WINDOW[spec.phase];
  if (window.days && window.days.length > 0 && !window.days.includes(localDayNumber(now))) {
    return false;
  }
  const [sh, sm] = window.start.split(':').map(Number);
  const [eh, em] = window.end.split(':').map(Number);
  const startMin = (sh ?? 0) * 60 + (sm ?? 0);
  const endMin = (eh ?? 0) * 60 + (em ?? 0);
  const curMin = now.getHours() * 60 + now.getMinutes();
  if (endMin <= startMin) {
    // Overnight window (e.g. 22:00 -> 05:00)
    return curMin >= startMin || curMin < endMin;
  }
  return curMin >= startMin && curMin < endMin;
}

// ============================================================================
// CONSUMPTION TRACKING (persisted to .draymond/delegation.json on write)
// ============================================================================

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const consumed: Record<string, { day: string; tokens: number }> = {};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Registry dir used by the treasury/ad hoc file discipline. */
function registryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? resolve(process.cwd(), '.draymond');
}

function consumptionFile(): string {
  return resolve(registryDir(), 'delegation.json');
}

interface PersistedConsumption {
  consumed: Record<string, { day: string; tokens: number }>;
  updatedAt: string;
}

let loaded = false;

/** Load persisted consumption from .draymond/delegation.json (once per process). */
function loadConsumption(): void {
  if (loaded) return;
  loaded = true;
  try {
    const file = consumptionFile();
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as PersistedConsumption;
    if (raw?.consumed && typeof raw.consumed === 'object') {
      for (const [slug, entry] of Object.entries(raw.consumed)) {
        if (entry && typeof entry.day === 'string' && typeof entry.tokens === 'number') {
          consumed[slug] = { day: entry.day, tokens: entry.tokens };
        }
      }
    }
  } catch (err) {
    console.warn(`[Delegation] failed to load consumption: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Persist consumption atomically (read-modify-write via temp file rename). */
function persistConsumption(): void {
  try {
    const file = consumptionFile();
    mkdirSync(dirname(file), { recursive: true });
    const payload: PersistedConsumption = { consumed, updatedAt: new Date().toISOString() };
    writeBrainFile(file, JSON.stringify(payload, null, 2), 'write', 'delegation');
  } catch (err) {
    console.warn(`[Delegation] failed to persist consumption: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Tokens already consumed by a component today. */
export function delegationConsumed(slug: string): number {
  loadConsumption();
  const entry = consumed[slug];
  if (!entry || entry.day !== todayKey()) return 0;
  return entry.tokens;
}

/** Record token consumption for a component (idempotent by day rollover). */
export function recordDelegationConsumption(slug: string, tokens: number): void {
  loadConsumption();
  const entry = consumed[slug];
  if (!entry || entry.day !== todayKey()) {
    consumed[slug] = { day: todayKey(), tokens: Math.max(0, tokens) };
  } else {
    entry.tokens += Math.max(0, tokens);
  }
  persistConsumption();
}

/** Remaining per-day token budget for a component (unbounded when unplanned). */
export function delegationRemaining(slug: string): number {
  const spec = delegationFor(slug);
  if (!spec) return Infinity;
  return Math.max(0, spec.tokenBudgetPerDay - delegationConsumed(slug));
}

/** True when the component can run right now (window + per-spec budget + sector cap). */
export function canDelegate(slug: string, now = new Date()): { ok: boolean; reason?: string } {
  const spec = delegationFor(slug);
  if (!spec) return { ok: true, reason: 'unplanned — no delegation spec' };
  if (!isWithinWindow(spec, now)) {
    return { ok: false, reason: `outside ${spec.label} window (${spec.window?.start ?? PHASE_WINDOW[spec.phase].start}-${spec.window?.end ?? PHASE_WINDOW[spec.phase].end})` };
  }
  const remaining = delegationRemaining(slug);
  if (remaining <= 0) {
    return { ok: false, reason: `${spec.label} daily token budget exhausted (${spec.tokenBudgetPerDay})` };
  }
  const sectorGate = canDelegateSector(specSector(spec), now);
  if (!sectorGate.ok) {
    return { ok: false, reason: sectorGate.reason };
  }
  return { ok: true };
}

// ============================================================================
// SECTOR AGGREGATE BUDGET (corporate layer enforcement)
// ============================================================================
// The per-sector daily cap from the revenue-target-weighted pool model is the
// hard ceiling. A component is blocked when its whole sector has consumed its
// cap — even if the component's own per-spec budget is untouched. This is what
// makes the corporate allocation real instead of advisory.

/** Tokens consumed today by every component in a sector. */
export function sectorConsumed(sector: SectorId): number {
  let total = 0;
  for (const member of sectorMemberSlugs(sector)) {
    total += delegationConsumed(member);
  }
  return total;
}

/** Remaining sector budget = sector cap - aggregate sector consumption today. */
export function sectorRemaining(sector: SectorId): number {
  const cap = sectorDailyCap(sector, fleetDailyBudget());
  return Math.max(0, cap - sectorConsumed(sector));
}

/** True when the sector still has aggregate budget to run components. */
export function canDelegateSector(sector: SectorId, now = new Date()): { ok: boolean; reason?: string } {
  const cap = sectorDailyCap(sector, fleetDailyBudget());
  const consumed = sectorConsumed(sector);
  if (consumed >= cap) {
    return {
      ok: false,
      reason: `sector "${sector}" daily token budget exhausted (${consumed}/${cap}) — corporate cap reached`,
    };
  }
  return { ok: true };
}

/** True when a sector is a revenue sector (E1-E4). */
export function isRevenueSector(sector: SectorId): boolean {
  return (REVENUE_SECTOR_IDS as string[]).includes(sector);
}

/** Per-run ceiling, falling back to a sensible default for unplanned work. */
export function delegationRunTokens(slug: string): number {
  return delegationFor(slug)?.tokenBudgetPerRun ?? 16_000;
}

/** Max duration for a run, falling back to a sensible default (5 min). */
export function delegationTimeBudgetMs(slug: string): number {
  return delegationFor(slug)?.timeBudgetMs ?? 300_000;
}

/** Time budget in whole seconds (scheduler `timeout_seconds`). */
export function delegationTimeoutSeconds(slug: string): number {
  return Math.max(30, Math.round(delegationTimeBudgetMs(slug) / 1000));
}

/** Reset all consumption (tests, day rollover). */
export function resetDelegation(): void {
  loadConsumption();
  for (const k of Object.keys(consumed)) delete consumed[k];
  try {
    const file = consumptionFile();
    if (existsSync(file)) {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ consumed, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
      renameSync(tmp, file);
    }
  } catch (err) {
    console.warn(`[Delegation] failed to clear persisted consumption: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface DelegationSnapshotEntry {
  slug: string;
  label: string;
  sector: SectorId;
  phase: DelegationPhase;
  window: DelegationWindow;
  timeBudgetMs: number;
  tokenBudgetPerRun: number;
  tokenBudgetPerDay: number;
  tier: DelegationTier;
  priority: number;
  duty: DelegationDuty;
  consumed: number;
  remaining: number;
  active: boolean;
  reason?: string;
}

export interface SectorSnapshotEntry {
  sector: SectorId;
  cap: number;
  consumed: number;
  remaining: number;
  active: boolean;
}

/** Full snapshot of the delegation plan + live state (dashboards / ops). */
export function delegationSnapshot(now = new Date()): {
  fleetDailyBudget: number;
  totalPlannedPerDay: number;
  phases: Record<DelegationPhase, number>;
  entries: DelegationSnapshotEntry[];
  sectors: SectorSnapshotEntry[];
} {
  const totalPlannedPerDay = DELEGATION_PLAN.reduce((a, s) => a + s.tokenBudgetPerDay, 0);
  const phases = { morning: 0, midday: 0, evening: 0, night: 0 } as Record<DelegationPhase, number>;
  for (const s of DELEGATION_PLAN) phases[s.phase] += s.tokenBudgetPerDay;
  const entries: DelegationSnapshotEntry[] = DELEGATION_PLAN.map((s) => {
    const gate = canDelegate(s.slug, now);
    return {
      slug: s.slug,
      label: s.label,
      sector: specSector(s),
      phase: s.phase,
      window: s.window ?? PHASE_WINDOW[s.phase],
      timeBudgetMs: s.timeBudgetMs,
      tokenBudgetPerRun: s.tokenBudgetPerRun,
      tokenBudgetPerDay: s.tokenBudgetPerDay,
      tier: s.tier,
      priority: s.priority,
      duty: s.duty,
      consumed: delegationConsumed(s.slug),
      remaining: delegationRemaining(s.slug),
      active: gate.ok,
      reason: gate.ok ? undefined : gate.reason,
    };
  });
  const sectors: SectorSnapshotEntry[] = Array.from(new Set(entries.map((e) => e.sector))).map(
    (sector) => {
      const gate = canDelegateSector(sector, now);
      return {
        sector,
        cap: sectorDailyCap(sector, fleetDailyBudget()),
        consumed: sectorConsumed(sector),
        remaining: sectorRemaining(sector),
        active: gate.ok,
      };
    },
  );
  return { fleetDailyBudget: fleetDailyBudget(), totalPlannedPerDay, phases, entries, sectors };
}
