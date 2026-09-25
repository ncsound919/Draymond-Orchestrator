// ============================================================================
// DRAYMOND BRAIN DECISION ENGINE — deterministic reasoning for business ops
// ============================================================================
// Draymond consults the deterministic brain's reasoning engine to decide what
// to do for the business, grounded in the operating AGENDA (systemic.ts goals +
// the brain's soul/planner). The loop:
//
//   1. Gather the agenda (active goals) + live system intel (failing jobs,
//      down monitors, health, repairs, learning lessons).
//   2. Ask the PRIMARY decision layer — Dev-Brain (POST /api/decide, weighted
//      deterministic matrix, no LLM) — for a bounded decision on where to
//      focus (which agenda goals, which hiccups to fix first). Falls back to
//      the local harness / deterministic brain /reason when Dev-Brain is down.
//   3. Route hiccups/issues to the repair + coding teams (repairFailedJob /
//      attemptRepair / startDownServices), bounded by evidence + cooldown so
//      repeated identical failures do NOT burn tokens or spam emails.
//   4. Record every decision + outcome to self-learning (recordOutcome) so the
//      SAME mistake is never repeated blindly — lessons drive the next decision.
//
// Dev-Brain is the advisor; Draymond is the executor. When Dev-Brain, the
// local harness, and the brain are all down, a deterministic fallback (agenda
// + intel → priority order) still runs, so business decisions never stall.
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

  // -- 1. Gather context (live unless overridden for tests) ---------------
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

  // -- 2. Build the decision context ------------------------------------------
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

  // -- 2a. PRIMARY: Dev-Brain (deterministic decision layer) -----------------
  // Dev-Brain is the fleet's primary decision advisor. When reachable, its
  // weighted decision matrix drives focus + repair ordering. Falls through to
  // the local harness when Dev-Brain is down — decisions never stall.
  let devBrain: { matrix: import('./dev-brain').DevBrainMatrix } | null = null;
  let localReason: { text: string | null; source: string | null } | null = null;
  let brainConsulted = input.brainReachable ?? false;
  let focusOverride: string | null = null;
  let devBrainRepairOrder: string[] | null = null;

  const decisionCandidates: import('./dev-brain').DevBrainCandidate[] = [
    ...agenda.map((g) => ({ id: `goal:${g.title}`, title: `Advance: ${g.title}`, description: `Agenda goal at ${g.progress}% progress.`, tags: ['agenda'] })),
    ...failingJobs.map((j) => ({ id: `job:${j.name}`, title: `Repair job: ${j.name}`, description: String(j.error ?? 'job failed').slice(0, 200), tags: ['repair'] })),
    ...downMonitors.map((m) => ({ id: `mon:${m}`, title: `Restore monitor: ${m}`, description: 'Monitor is down.', tags: ['repair'] })),
  ];

  try {
    const { devBrainReachable, devBrainDecide } = await import('./dev-brain');
    if (await devBrainReachable()) {
      const matrix = await devBrainDecide({ problem: brainQuery, candidates: decisionCandidates });
      if (matrix) {
        brainConsulted = true;
        devBrain = { matrix };
        const rec = matrix.options.find((o) => o.id === matrix.recommendedOptionId);
        if (rec) focusOverride = rec.title.replace(/^Advance: /, '');
        devBrainRepairOrder = matrix.options
          .filter((o) => o.id.startsWith('job:') || o.id.startsWith('mon:'))
          .sort((a, b) => b.weightPercentage - a.weightPercentage)
          .map((o) => o.id);
      }
    }
  } catch { /* fall through to local harness */ }

  // -- 2a1. TRICKY SITUATION ESCALATION (locked plan 2026-09-22 §6d) ---------
  // When multiple independent failure signals are present (jobs + monitors
  // together) the decision is ambiguous, so escalate through Dev-Brain's JEV
  // path (/api/decide/jev). Dev-Brain's matrix stays authoritative; JEV adds a
  // calibrated choice advisory. Honest: if Dev-Brain or JEV is unreachable the
  // result is 'unavailable' and we fall through to local handling — never a
  // fabricated verdict.
  const { escalateTrickyDecision } = await import('./tricky-decision');
  const trickySignals = failingJobs.length + downMonitors.length >= 2;
  if (trickySignals && !devBrain) {
    const escalated = await escalateTrickyDecision({
      problem: brainQuery,
      category: 'ambiguous',
      options: decisionCandidates.map((c) => ({ id: c.id, title: c.title, description: c.description, tags: c.tags })),
      context: `failingJobs=${failingJobs.length}; downMonitors=${downMonitors.length}; agendaGoals=${agenda.length}`,
    });
    if (escalated.ok && escalated.matrix) {
      brainConsulted = true;
      devBrain = { matrix: escalated.matrix as unknown as import('./dev-brain').DevBrainMatrix };
      const rec = escalated.matrix.options?.find((o) => o.id === escalated.recommendedOptionId);
      if (rec) focusOverride = rec.title?.replace(/^Advance: /, '') ?? null;
      devBrainRepairOrder = (escalated.matrix.options ?? [])
        .filter((o) => o.id.startsWith('job:') || o.id.startsWith('mon:'))
        .sort((a, b) => ((b as { weightPercentage?: number }).weightPercentage ?? 0) - ((a as { weightPercentage?: number }).weightPercentage ?? 0))
        .map((o) => o.id);
    }
  }

  // -- 2a2. Dev-Brain → OpenHub ecosystem repair report ----------------------
  // When a tricky decision found failing jobs or down monitors, mirror them to
  // OpenHub's ecosystem-aware repair intake so OpenHub audits the affected
  // tool's preloaded local folder and dispatches the fix to Axiom. Best-effort
  // (dev-brain source, never blocks the decision path).
  if (trickySignals) {
    try {
      const { reportToOpenHubBestEffort } = await import('./openhub-report');
      const detail = [
        ...failingJobs.slice(0, 3).map((j) => `job ${j.name}: ${String(j.error ?? '').slice(0, 120)}`),
        ...downMonitors.slice(0, 3).map((m) => `monitor ${m} down`),
      ].join(' | ');
      await reportToOpenHubBestEffort({
        toolId: 'draymond',
        source: 'dev-brain',
        severity: 'high',
        kind: 'tricky-decision',
        detail: detail.slice(0, 2000),
        preset: 'quick',
        dedupKey: `tricky:${failingJobs.map((j) => j.name).sort().join(',')}:${downMonitors.slice(0, 2).sort().join(',')}`,
      });
    } catch { /* best-effort */ }
  }

  // -- 2b. Fallback: local harness / deterministic brain ---------------------
  if (!brainConsulted) {
    const { reasonLocal: local } = await import('./local-reason');
    localReason = await local(brainQuery);
    brainConsulted = input.brainReachable ?? (localReason.source !== null);
  }

  // Also trigger a bounded brain sweep when the brain is up (metacognitive
  // observation over the knowledge graph feeds future sweeps).
  let sweepRan = false;
  if (brainConsulted && process.env.DRAYMOND_BRAIN_SWEEP_ON_DECISION === '1') {
    const report = await runBrainSweep({ mode: 'agenda', scope: 'all', maxFindings: 10 }).catch(() => null);
    sweepRan = Boolean(report);
  }

  // -- 3. Focus goal: Dev-Brain recommendation, else least-progress agenda. -
  const focusGoal = focusOverride ?? (agenda.length ? [...agenda].sort((a, b) => a.progress - b.progress)[0]!.title : null);
  if (focusGoal) {
    priorities.push({ id: 'goal', label: `Advance agenda: ${focusGoal}`, why: 'lowest progress goal pulls the mission forward', agent: 'overlay-strategist' });
  }

  // -- 4. Repair queue: hiccups → repair/coding teams, bounded. ------------
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
  // Sort: monitors first (cheap health), then jobs — unless Dev-Brain ranked
  // the repair options (its weighted matrix is the primary ordering).
  if (devBrainRepairOrder) {
    const pos = new Map(devBrainRepairOrder.map((id, i) => [id, i]));
    const idFor = (r: BrainDecision['repairQueue'][number]): string | undefined => {
      if (r.kind === 'job') return `job:${r.detail.match(/^job (.+?):/)?.[1] ?? r.detail}`;
      if (r.kind === 'monitor') return `mon:${r.detail.replace('monitor ', '').replace(' down', '')}`;
      return undefined;
    };
    repairQueue.sort((a, b) => {
      const pa = idFor(a); const pb = idFor(b);
      const wa = pa === undefined ? undefined : pos.get(pa);
      const wb = pb === undefined ? undefined : pos.get(pb);
      if (wa === undefined && wb === undefined) return a.priority - b.priority;
      if (wa === undefined) return 1;
      if (wb === undefined) return -1;
      return wa - wb;
    });
  } else {
    repairQueue.sort((a, b) => a.priority - b.priority);
  }

  // -- 4b. Free-API key acquisition list (the "fill the API list" drive). ---
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

  // -- 5. Take bounded actions (repair/coding dispatch + learning feedback). -
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

  // -- 6. Self-learning feedback: record the decision outcome. --------------
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
    brainReasoning: devBrain
      ? { query: brainQuery.slice(0, 400), decision: `Dev-Brain: ${devBrain.matrix.recommendedOptionId} — ${devBrain.matrix.synthesisRationale.slice(0, 300)}` }
      : localReason?.text
        ? { query: brainQuery.slice(0, 400), decision: localReason.text }
        : null,
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
