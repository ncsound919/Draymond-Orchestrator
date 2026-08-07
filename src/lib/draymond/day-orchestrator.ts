/**
 * Day Orchestrator — Draymond controls the daily flow.
 *
 * A coherent daily rhythm across all systems: each phase groups the jobs that
 * must run together, in order, with data feeding downstream agents (e.g. market
 * snapshot feeds the financial agents). Draymond can run a phase group on
 * demand or let the individual crons drive it — this module is the plan + the
 * phase runner.
 */

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
  { id: 'treasury', phase: 'morning', time: '08:00', job: 'overlay-treasurer', purpose: 'Cash pulse with market context', feedsTo: ['mission-pipeline'] },
  { id: 'mission', phase: 'morning', time: '09:30', job: 'wf-mission-sync', purpose: 'Pipeline + revenue vs target' },
  // ── Midday — steady state ───────────────────────────────────────────────
  { id: 'duty', phase: 'midday', time: 'hourly', job: 'fleet_duty_sync', purpose: 'On-duty roster check' },
  { id: 'repair', phase: 'midday', time: ':15', job: 'self_repair_check', purpose: 'Auto-repair failures / escalate' },
  { id: 'marketing', phase: 'midday', time: '10:00', job: 'marketing-pulse', purpose: 'Content + pipeline top-of-funnel' },
  // ── Evening — prepare next day ──────────────────────────────────────────
  { id: 'eve-marketing', phase: 'evening', time: '20:00', job: 'marketing-pulse', purpose: 'Build next-day marketing tools' },
  // ── Night — learn + build while idle ────────────────────────────────────
  { id: 'learn', phase: 'night', time: '00:30', job: 'self_learning_loop', purpose: 'Distill lessons from the day' },
  { id: 'rd', phase: 'night', time: '01:00', job: 'rd_night', purpose: 'Overnight research + dev plan' },
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
}

/** Run every step in a phase group (best-effort, order preserved). */
export async function runPhase(phase: DayPhase): Promise<PhaseRunResult> {
  const steps = DAY_FLOW.filter((s) => s.phase === phase);
  const executed: string[] = [];
  const errors: string[] = [];

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
    scan_book_library: async () => (await import('../bookbridge')).scanBookLibrary(),
    wiki_sync: async () => {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      return promisify(execFile)('node', ['scripts/sync-wiki-to-supabase.mjs'], { timeout: 120_000 });
    },
    fleet_duty_sync: async () => (await import('./fleet-duty')).computeFleetDuty(),
    generate_agent_avatars: async () => {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      return promisify(execFile)('node', ['scripts/generate-agent-avatars.mjs'], { timeout: 600_000 });
    },
  };

  for (const step of steps) {
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
  return { phase, executed, errors };
}
