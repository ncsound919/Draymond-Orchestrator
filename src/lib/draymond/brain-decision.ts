// ============================================================================
// DRAYMOND BRAIN DECISION ENGINE — deterministic reasoning for business ops
// ============================================================================
// Draymond consults the deterministic brain's reasoning engine to decide what
// to do for the business, grounded in the operating AGENDA (systemic.ts goals +
// the brain's soul/planner). The loop:
//
//   1. Gather the agenda (active goals) + live system intel (failing jobs,
//      down monitors, health, repairs, learning lessons).
//   2. Ask the deterministic brain `/reason` for a bounded decision on where
//      to focus (which agenda goals, which hiccups to fix first).
//   3. Route hiccups/issues to the repair + coding teams (repairFailedJob /
//      attemptRepair / startDownServices), bounded by evidence + cooldown so
//      repeated identical failures do NOT burn tokens or spam emails.
//   4. Record every decision + outcome to self-learning (recordOutcome) so the
//      SAME mistake is never repeated blindly — lessons drive the next decision.
//
// The brain is the advisor; Draymond is the executor. When BRAIN_URL is unset
// or the brain is offline, a deterministic fallback (agenda + intel → priority
// order) still runs, so business decisions never stall on the brain being down.
// ============================================================================

import { runBrainSweep } from './brain-client';
import { getSystemIntel } from './system-intel';
import { OVERLAY365_AGENDA } from './systemic';
import { getLessons } from './self-learning';
import { missingCriticalKeys } from './api-keys';

// ============================================================================
// INPUTS
// ============================================================================

export interface BrainDecisionInput {
  /** Optional override: skip live DB reads (tests). */
  agenda?: Array<{ title: string; progress: number }>;
  failingJobs?: Array<{ name: string; error?: string }>;
  downMonitors?: string[];
  lessons?: Array<{ agentId: string; lesson: string; evidenceCount: number }>;
  brainReachable?: boolean;
}

export interface BrainDecision {
  generatedAt: string;
  /** Whether the deterministic brain /reason was actually consulted. */
  brainConsulted: boolean;
  /** The brain's raw reasoning (bounded), when available. */
  brainReasoning: { query: string; decision: string } | null;
  /** Agenda goal the decision focuses on (mission-relevant). */
  focusGoal: string | null;
  /** Ranked priorities — what to do first. */
  priorities: Array<{ id: string; label: string; why: string; agent: string }>;
  /** Hiccups that should be routed to the repair/coding teams. */
  repairQueue: Array<{ signal: string; detail: string; kind: 'job' | 'monitor' | 'service'; priority: number }>;
  /** Actions actually taken (bounded). */
  actions: Array<{ action: string; detail: string; ok: boolean }>;
}

// ============================================================================
// BRAIN CLIENT — /reason (deterministic reasoning) + agenda alignment
// ============================================================================

const BRAIN_URL = () => process.env.BRAIN_URL ?? '';

async function callBrainReason(query: string): Promise<{ consulted: boolean; decision: string | null }> {
  if (!BRAIN_URL()) return { consulted: false, decision: null };
  try {
    const res = await fetch(`${BRAIN_URL().replace(/\/+$/, '')}/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { consulted: true, decision: null };
    const data = (await res.json()) as { decision?: unknown; task?: unknown };
    const decision = data.decision ? JSON.stringify(data.decision).slice(0, 2000) : null;
    return { consulted: true, decision };
  } catch {
    return { consulted: true, decision: null };
  }
}

// ============================================================================
// DETERMINISTIC FALLBACK — agenda + intel → priority ordering (no LLM)
// ============================================================================

/** Pull the operating agenda into a compact, decision-ready shape. */
async function loadAgenda(): Promise<Array<{ title: string; progress: number }>> {
  const supabase = (await import('./client')).createDraymondAdminClient();
  const { data } = await supabase
    .from('draymond_goals')
    .select('title, progress_pct, horizon, status')
    .eq('status', 'active')
    .limit(50)
    .catch(() => ({ data: null }));
  if (data && data.length > 0) {
    return (data as Array<{ title: string; progress_pct: number }>).map((g) => ({ title: g.title, progress: g.progress_pct ?? 0 }));
  }
  // Fallback to the static seed agenda when the DB has none.
  return OVERLAY365_AGENDA.map((g) => ({ title: g.title, progress: 0 }));
}

// ============================================================================
// MAIN DECISION LOOP
// ============================================================================

/**
 * Run one decision cycle: reason over the agenda + system state, rank what to
 * do, and take bounded repair actions. Never throws — returns the decision so
 * the caller (scheduler job / API) can log it.
 */
export async function runBrainDecision(input: BrainDecisionInput = {}): Promise<BrainDecision> {
  const generatedAt = new Date().toISOString();
  const actions: BrainDecision['actions'] = [];
  const priorities: BrainDecision['priorities'] = [];

  // ── 1. Gather context (live unless overridden for tests) ───────────────
  const [agenda, intel, lessons] = await Promise.all([
    input.agenda ?? loadAgenda(),
    getSystemIntel().catch(() => null),
    input.lessons ?? getLessons(),
  ]);

  const failingJobs = (input.failingJobs ?? intel?.jobs.failed_recently ?? []).map((j) => ({
    name: j.name,
    error: (j as { error?: string }).error ?? '',
  }));
  const downMonitors = input.downMonitors ?? intel?.monitors.down ?? [];
  const lessonList = lessons.map((l) => `${l.agentId}: ${l.lesson} (x${l.evidenceCount})`).slice(0, 10);

  // ── 2. Consult the deterministic brain's reasoning engine ───────────────
  const brainQuery = [
    'Business operations decision. Agenda:',
    agenda.map((g) => `- ${g.title} (${g.progress}%)`).join('\n') || '- none',
    '',
    'Current hiccups:',
    failingJobs.length ? failingJobs.map((j) => `- job ${j.name}: ${String(j.error ?? '').slice(0, 120)}`).join('\n') : '- none',
    downMonitors.length ? `down monitors: ${downMonitors.join(', ')}` : '- all monitors up',
    '',
    'Prior lessons:',
    lessonList.length ? lessonList.join('\n') : '- none yet',
    '',
    'Recommend the single highest-value focus + the top 3 hiccups to repair first, considering the agenda.',
  ].join('\n');

  const brainResult = await callBrainReason(brainQuery);
  const brainConsulted = input.brainReachable ?? brainResult.consulted;

  // Also trigger a bounded brain sweep when the brain is up (metacognitive
  // observation over the knowledge graph feeds future sweeps).
  let sweepRan = false;
  if (brainConsulted && process.env.DRAYMOND_BRAIN_SWEEP_ON_DECISION === '1') {
    const report = await runBrainSweep({ mode: 'agenda', scope: 'all', maxFindings: 10 }).catch(() => null);
    sweepRan = Boolean(report);
  }

  // ── 3. Focus goal: the least-progress agenda goal (mission pull). ───────
  const focusGoal = agenda.length ? [...agenda].sort((a, b) => a.progress - b.progress)[0]!.title : null;
  if (focusGoal) {
    priorities.push({ id: 'goal', label: `Advance agenda: ${focusGoal}`, why: 'lowest progress goal pulls the mission forward', agent: 'overlay-strategist' });
  }

  // ── 4. Repair queue: hiccups → repair/coding teams, bounded. ────────────
  const repairQueue: BrainDecision['repairQueue'] = [];
  for (const j of failingJobs) {
    repairQueue.push({
      signal: 'job:error',
      detail: `job ${j.name}: ${String(j.error ?? 'unknown error').slice(0, 300)}`,
      kind: 'job',
      priority: 3,
    });
  }
  for (const m of downMonitors) {
    repairQueue.push({ signal: 'monitor:down', detail: `monitor ${m} down`, kind: 'monitor', priority: 2 });
  }
  // Sort: monitors first (cheap health), then jobs.
  repairQueue.sort((a, b) => a.priority - b.priority);

  // ── 4b. Free-API key acquisition list (the "fill the API list" drive). ───
  // Missing mission-critical keys (E1-E4) become a priority so the fleet can
  // generate them (coding agent) or the human signs up. Never logs key values.
  const criticalMissing = missingCriticalKeys(10);
  for (const k of criticalMissing) {
    priorities.push({
      id: `api-key:${k.name}`,
      label: `Acquire ${k.name} API key (${k.engine})`,
      why: `mission-critical free API not configured — env ${k.envVars.join(', ')}`,
      agent: 'uplift-agent',
    });
    if (priorities.length <= 8) {
      repairQueue.push({
        signal: 'api-key:missing',
        detail: `${k.name} (${k.engine}) — add ${k.envVars.join(', ')} to .env.local${k.signupUrl ? ` · signup: ${k.signupUrl}` : ''}`,
        kind: 'service',
        priority: 1,
      });
    }
  }

  // ── 5. Take bounded actions (repair/coding dispatch + learning feedback). ─
  const { isOnCooldown } = await import('./workflow-budget');
  const taken = new Set<string>();

  // a) Down monitors → service start (deterministic, cheap).
  for (const m of downMonitors.slice(0, 2)) {
    const key = `brain:monitor:${m}`;
    if (taken.has(key) || isOnCooldown(key, 'repair', 30 * 60 * 1000)) continue;
    taken.add(key);
    try {
      const { attemptRepair } = await import('./self-repair');
      const r = await attemptRepair('monitor:down', `brain decision: ${m} down`);
      actions.push({ action: 'repair:monitor', detail: `${m} → ${r.status}: ${r.detail}`, ok: r.status === 'applied' });
    } catch (err) {
      actions.push({ action: 'repair:monitor', detail: `${m} → ${err instanceof Error ? err.message : String(err)}`, ok: false });
    }
  }

  // b) Failing jobs → repair team (config fixes / service start / coding crew).
  for (const j of failingJobs.slice(0, 3)) {
    const key = `brain:job:${j.name}`;
    if (taken.has(key) || isOnCooldown(key, 'repair', 30 * 60 * 1000)) continue;
    taken.add(key);
    try {
      const { listJobs: getJobs, updateJob } = await import('./scheduler');
      const { repairFailedJob } = await import('./repair-team');
      const jobRow = (await getJobs()).find((jb) => jb.name === j.name);
      if (!jobRow) {
        actions.push({ action: 'repair:job', detail: `${j.name} not found in job table — skip`, ok: false });
        continue;
      }
      const report = await repairFailedJob(
        { id: jobRow.id, name: jobRow.name, job_type: jobRow.job_type, job_config: jobRow.job_config ?? {} },
        String(j.error ?? 'unknown error'),
        { updateJobConfig: (id, config) => updateJob(id, { job_config: config }) },
      );
      actions.push({ action: 'repair:job', detail: `${j.name} → ${report.action}: ${report.detail}`, ok: report.action === 'fixed' });
    } catch (err) {
      actions.push({ action: 'repair:job', detail: `${j.name} → ${err instanceof Error ? err.message : String(err)}`, ok: false });
    }
  }

  // ── 6. Self-learning feedback: record the decision outcome. ──────────────
  const issueCount = failingJobs.length + downMonitors.length;
  const fixedCount = actions.filter((a) => a.ok).length;
  const deferredCount = Math.max(0, issueCount - actions.length);
  try {
    const { recordOutcome } = await import('./self-learning');
    await recordOutcome({
      agentId: 'brain-decision',
      kind: 'incident',
      summary: `brain decision cycle: ${issueCount} issues, ${fixedCount} fixed, ${deferredCount} deferred`,
      success: fixedCount > 0 || issueCount === 0,
      detail: `focus=${focusGoal ?? 'none'}; brain=${brainConsulted}; sweep=${sweepRan}; actions=${actions.length}; priorities=${priorities.length}`,
    });
  } catch { /* best-effort */ }

  return {
    generatedAt,
    brainConsulted,
    brainReasoning: brainResult.decision ? { query: brainQuery.slice(0, 400), decision: brainResult.decision } : null,
    focusGoal,
    priorities,
    repairQueue,
    actions,
  };
}

// ============================================================================
// EXPORT — share a compact agenda snapshot for the scheduler / dashboard
// ============================================================================

/** The operating agenda as a compact snapshot (used by the decision engine). */
export async function agendaSnapshot(): Promise<Array<{ title: string; progress: number }>> {
  return loadAgenda();
}
