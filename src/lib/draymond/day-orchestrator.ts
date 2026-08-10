/**
 * Day Orchestrator — Draymond controls the daily flow.
 *
 * A coherent daily rhythm across all systems: each phase groups the jobs that
 * must run together, in order, with data feeding downstream agents (e.g. market
 * snapshot feeds the financial agents). Draymond can run a phase group on
 * demand or let the individual crons drive it — this module is the plan + the
 * phase runner.
 */

import { estimateTokens, costAwareOrder } from '../mathx';

export type DayPhase = 'morning' | 'midday' | 'evening' | 'night';

export interface OrchestrationStep {
  id: string;
  phase: DayPhase;
  time: string; // "HH:MM" local
  job: string; // scheduler job name / handler
  purpose: string;
  /** Agents/systems this step feeds. */
  feedsTo?: string[];
}

export const DAY_FLOW: OrchestrationStep[] = [
  // ── Morning — data in, then deliver ─────────────────────────────────────
  { id: 'sec-scan', phase: 'morning', time: '05:00', job: 'supply-chain-health', purpose: 'Dependency/SCA scan', feedsTo: ['overlay-auditor'] },
  { id: 'news', phase: 'morning', time: '06:00', job: 'ingest_news', purpose: 'Current events into the fleet', feedsTo: ['overlay-strategist', 'omniresearch-pro'] },
  { id: 'market', phase: 'morning', time: '07:00', job: 'fetch_market_data', purpose: 'Crypto + papers snapshot', feedsTo: ['overlay-treasurer', 'trading-agents', 'ghostfolio-engine', 'sports-steve'] },
  { id: 'qa', phase: 'morning', time: '07:00', job: 'run_overlay_qa', purpose: 'Site integrity pass', feedsTo: ['overlay-auditor'] },
  { id: 'treasury', phase: 'morning', time: '08:00', job: 'treasury_pulse', purpose: 'Cash pulse with market context', feedsTo: ['mission-pipeline'] },
  { id: 'mission', phase: 'morning', time: '09:30', job: 'wf-mission-sync', purpose: 'Pipeline + revenue vs target' },
  // ── Midday — steady state ───────────────────────────────────────────────
  { id: 'duty', phase: 'midday', time: 'hourly', job: 'fleet_duty_sync', purpose: 'On-duty roster check' },
  { id: 'repair', phase: 'midday', time: ':15', job: 'self_repair_check', purpose: 'Auto-repair failures / escalate' },
  { id: 'bmk', phase: 'midday', time: '13:00', job: 'benchmark_chains', purpose: 'Benchmark chain health', feedsTo: ['deterministic-brain'] },
  { id: 'marketing', phase: 'midday', time: '10:00', job: 'marketing-pulse', purpose: 'Content + pipeline top-of-funnel' },
  // ── Evening — prepare next day ──────────────────────────────────────────
  { id: 'eve-marketing', phase: 'evening', time: '20:00', job: 'marketing-pulse', purpose: 'Build next-day marketing tools' },
  // ── Night — learn + build while idle ────────────────────────────────────
  { id: 'learn', phase: 'night', time: '00:30', job: 'self_learning_loop', purpose: 'Distill lessons from the day' },
  { id: 'rd', phase: 'night', time: '01:00', job: 'rd_night', purpose: 'Overnight research + dev plan' },
  { id: 'dream', phase: 'night', time: '02:00', job: 'dream_cycle', purpose: 'AutoDream memory consolidation (gated)', feedsTo: ['memory-intelligence'] },
  { id: 'ultraplan', phase: 'night', time: '02:30', job: 'ultraplan_process', purpose: 'Deep-plan queue drain' },
  { id: 'books', phase: 'night', time: '03:00', job: 'scan_book_library', purpose: 'Ingest new books' },
  { id: 'wiki', phase: 'night', time: '03:30', job: 'wiki_sync', purpose: 'Sync brain wiki to Supabase cache', feedsTo: ['deterministic-brain'] },
  { id: 'avatars', phase: 'night', time: '04:00', job: 'generate_agent_avatars', purpose: 'Refresh agent photos (weekly)' },
];

export function currentPhase(now = new Date()): DayPhase {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'midday';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export function dayPlan(now = new Date()): {
  phase: DayPhase;
  steps: OrchestrationStep[];
  nextDue: OrchestrationStep | null;
  byPhase: Record<DayPhase, OrchestrationStep[]>;
} {
  const byPhase: Record<DayPhase, OrchestrationStep[]> = {
    morning: DAY_FLOW.filter((s) => s.phase === 'morning'),
    midday: DAY_FLOW.filter((s) => s.phase === 'midday'),
    evening: DAY_FLOW.filter((s) => s.phase === 'evening'),
    night: DAY_FLOW.filter((s) => s.phase === 'night'),
  };
  const phase = currentPhase(now);
  const steps = byPhase[phase];

  // Next due step = the earliest upcoming scheduled step (by time) after now.
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let nextDue: OrchestrationStep | null = null;
  let nextDist = Infinity;
  for (const s of DAY_FLOW) {
    if (s.time === 'hourly' || s.time.startsWith(':')) continue;
    const [h, m] = s.time.split(':').map(Number);
    const tMin = (h ?? 0) * 60 + (m ?? 0);
    const dist = tMin > nowMin ? tMin - nowMin : tMin - nowMin + 24 * 60;
    if (dist < nextDist) {
      nextDist = dist;
      nextDue = s;
    }
  }

  return { phase, steps, nextDue, byPhase };
}

export interface PhaseRunResult {
  phase: DayPhase;
  executed: string[];
  errors: string[];
  /** Steps skipped because the optional token budget could not cover them. */
  dropped?: string[];
  /** Estimated tokens the executed steps would consume. */
  estimated_tokens?: number;
}

const PHASE_WEIGHT: Record<DayPhase, number> = { morning: 3, midday: 2, evening: 2, night: 1 };

const PHASE_OFFSET: Record<DayPhase, number> = { morning: 0, midday: 1440, evening: 2880, night: 4320 };

/** Estimate the LLM-context tokens a step will need (prose heuristic). */
export function estimateStepTokens(step: OrchestrationStep): number {
  return estimateTokens(`${step.purpose} ${step.job} ${step.id}`, 'prose');
}

/** Total estimated token cost of the full day plan, per phase. */
export function dayTokenBudget(): { total: number; byPhase: Record<DayPhase, number> } {
  const byPhase = { morning: 0, midday: 0, evening: 0, night: 0 } as Record<DayPhase, number>;
  for (const s of DAY_FLOW) byPhase[s.phase] += estimateStepTokens(s);
  return { total: Object.values(byPhase).reduce((a, b) => a + b, 0), byPhase };
}

/** Absolute deadline (minutes since midnight of the first phase) for a step. */
function stepDeadline(step: OrchestrationStep): number {
  const base = PHASE_OFFSET[step.phase];
  if (step.time === 'hourly') return base + 60;
  if (step.time.startsWith(':')) {
    const m = Number(step.time.slice(1)) || 15;
    return base + m;
  }
  const [h, m] = step.time.split(':').map(Number);
  return base + ((h ?? 0) * 60 + (m ?? 0));
}

/**
 * Run a phase group (best-effort, order preserved). Pass `budgetTokens` to make
 * the run cost-aware: steps are prioritized by weighted earliest-deadline and
 * the overflow is dropped instead of run, so the phase stays inside a token cap.
 */
export async function runPhase(phase: DayPhase, budgetTokens?: number): Promise<PhaseRunResult> {
  const steps = DAY_FLOW.filter((s) => s.phase === phase);
  const executed: string[] = [];
  const errors: string[] = [];

  let runSteps = steps;
  const dropped: string[] = [];
  if (budgetTokens !== undefined && budgetTokens > 0) {
    const ordered = costAwareOrder(
      steps.map((s) => ({
        id: s.id,
        tokens: estimateStepTokens(s),
        costPerToken: 1,
        deadline: stepDeadline(s),
        weight: PHASE_WEIGHT[s.phase],
      })),
      budgetTokens,
    );
    runSteps = ordered.scheduled
      .map((r) => steps.find((s) => s.id === r.id))
      .filter((s): s is OrchestrationStep => Boolean(s));
    dropped.push(...ordered.dropped);
  }

  const handlers: Record<string, () => Promise<unknown>> = {
    ingest_news: async () => (await import('./news')).ingestNews(),
    fetch_market_data: async () => {
      const d = await import('./data-apis');
      return { crypto: await d.cryptoPrices(), papers: await d.openAlexWorks('artificial intelligence business', 3) };
    },
    self_learning_loop: async () => (await import('./self-learning')).distillLessons(),
    self_repair_check: async () => {
      const m = await import('./monitors');
      const r = await import('./self-repair');
      const sites = await m.checkAllSites();
      const down = sites.results.filter((s) => !s.is_up).slice(0, 3);
      return Promise.all(down.map((s) => r.attemptRepair('monitor:down', `${s.monitor_name} down`)));
    },
    rd_night: async () => {
      const n = await import('./news');
      const r = await import('./rd-night');
      const digest = await n.newsDigest();
      return r.buildNightPlan(digest.items.slice(0, 5).map((i) => i.title));
    },
    dream_cycle: async () => (await import('./dream-cycle')).runDreamCycle(),
    ultraplan_process: async () => (await import('./ultraplan')).processNextUltraplan(),
    scan_book_library: async () => (await import('../bookbridge')).scanBookLibrary(),
    wiki_sync: async () => {
      // Fail-soft: the sync script exits non-zero if data/draymond.db is
      // missing (e.g. a read-only runtime or a fresh install). Skip cleanly so
      // the night phase doesn't collect a spurious wiki error.
      const fs = await import('node:fs');
      const pathMod = await import('node:path');
      const dbFile =
        process.env.DRAYMOND_DB_PATH ??
        pathMod.default.join(process.cwd(), 'data', 'draymond.db');
      if (!fs.default.existsSync(dbFile)) {
        return { skipped: 'wiki sync requires the local database (start the app once)' };
      }
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      return promisify(execFile)('node', ['scripts/sync-wiki-to-sqlite.mjs'], { timeout: 120_000 });
    },
    fleet_duty_sync: async () => (await import('./fleet-duty')).computeFleetDuty(),
    treasury_pulse: async () => {
      const { runTreasuryPulse } = await import('./treasury');
      const lookbackDays = Number(process.env.TREASURY_LOOKBACK_DAYS ?? 30);
      return runTreasuryPulse(Number.isFinite(lookbackDays) ? lookbackDays : 30);
    },
    generate_agent_avatars: async () => {
      // Fail-soft: avatar generation needs the Gemini key + registry, and is a
      // weekly optional task. Skip cleanly when either is unavailable so the
      // night phase doesn't collect a spurious avatars error.
      const fs = await import('node:fs');
      const pathMod = await import('node:path');
      const registryDir = process.env.DRAYMOND_REGISTRY_DIR ?? pathMod.default.join(process.cwd(), '.draymond');
      if (!process.env.GEMINI_API_KEY || !fs.default.existsSync(pathMod.default.join(registryDir, 'registry.json'))) {
        return { skipped: 'avatar generation requires GEMINI_API_KEY and the registry (weekly optional)' };
      }
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      return promisify(execFile)('node', ['scripts/generate-agent-avatars.mjs'], { timeout: 600_000 });
    },
  };

  for (const step of runSteps) {
    const fn = handlers[step.job];
    if (!fn) {
      executed.push(`${step.id} (cron-driven: ${step.job})`);
      continue;
    }
    try {
      await fn();
      executed.push(step.id);
    } catch (err) {
      errors.push(`${step.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const result: PhaseRunResult = { phase, executed, errors };
  if (budgetTokens !== undefined) {
    result.dropped = dropped;
    result.estimated_tokens = runSteps.reduce((a, s) => a + estimateStepTokens(s), 0);
  }
  return result;
}
