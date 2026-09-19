// ============================================================================
// DRAYMOND CODING REPAIR — dispatch the coding crew on a failing job
// ============================================================================
// When a job fails, Draymond hands it to the coding crew to GENERATE a fix.
// The fix is returned as a structured proposal (patch / config rewrite /
// command) so the repair team can either apply it deterministically or hand it
// to the crew lead for review.
//
// Engine chain (never throws, never stalls):
//   1. opencode (primary codegen engine) — synchronous, applies job_config
//      patches deterministically when the reply is valid JSON.
//   2. Uplift Agent (codegen fallback per the master coding stack) — dispatched
//      as an async repair task when opencode is unreachable/empty.
//   3. Deterministic terminal plan — a fixed, templated actionable escalation
//      so a total engine outage can't leave the pipeline stuck.
//
// Token-saving design:
//   - Only dispatched when NOT on cooldown (enforced by repair-team.ts).
//   - The prompt is small and focused: job config + error + the distilled
//     lesson, not the whole system.
//   - Results are capped in size.
// ============================================================================

import type { RepairCrew } from './repair-team';
import { localJobConfigProposal, repairLocalEnabled } from './local-repair';
import { recourseGroundingBlock } from './repair-crew';

export interface CodingRepairOutcome {
  action: 'fixed' | 'handed-off' | 'escalated';
  detail: string;
  dispatch: {
    kind: 'codegen';
    engine: string;
    result: string;
    duration_ms?: number;
  };
}

interface RepairJobLike {
  id: string;
  name: string;
  job_type: string;
  job_config: Record<string, unknown>;
}

export interface CodingRepairOptions {
  /** Per-engine timeout (ms). Defaults to DRAYMOND_REPAIR_CODEGEN_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Skip the Uplift Agent fallback (tests / diagnostics). */
  skipUplift?: boolean;
}

/** Trim a long result so the repair log stays small. */
function clip(s: string, n = 1200): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/** Build the focused codegen prompt for a failing job. */
function buildRepairPrompt(
  job: RepairJobLike,
  error: string,
  lessonHints: string[],
  recourseBlock = '',
): string {
  return [
    `You are the Draymond coding repair agent. A scheduled job is failing.`,
    ``,
    `JOB: ${job.name} (type: ${job.job_type})`,
    `JOB CONFIG: ${JSON.stringify(job.job_config).slice(0, 800)}`,
    `ERROR: ${error.slice(0, 800)}`,
    lessonHints.length ? `LESSONS (prior repeated failures):\n${lessonHints.join('\n').slice(0, 800)}` : '',
    recourseBlock ? `\n${recourseBlock.slice(0, 2000)}` : '',
    ``,
    `Diagnose the root cause and propose a concrete, minimal fix.`,
    `If the job_config is wrong, output ONLY the corrected job_config JSON.`,
    `If env/service/config changes are needed, output a short actionable plan.`,
    `Do NOT invent external credentials. Be specific and concise.`,
  ].filter(Boolean).join('\n');
}

/**
 * Deterministic terminal fallback — a fixed, templated escalation plan used
 * when EVERY codegen engine is down. No LLM in this path, so a total outage
 * degrades to an actionable assignment instead of a stall.
 */
export function deterministicRepairPlan(job: RepairJobLike, error: string, crew: RepairCrew): string {
  return (
    `Deterministic fallback — both codegen engines (opencode + uplift-agent) unreachable. ` +
    `Assign ${crew.lead}${crew.members.length ? ` (+ ${crew.members.join(', ')})` : ''} to patch job "${job.name}": ` +
    `${clip(error, 300)}`
  );
}

/**
 * Run opencode headless to propose a fix for a failing job. On failure it falls
 * back to the Uplift Agent (api_call), then to a deterministic plan. Never throws.
 */
export async function dispatchCodingRepair(
  job: RepairJobLike,
  error: string,
  lessonHints: string[],
  crew: RepairCrew,
  opts: CodingRepairOptions = {},
): Promise<CodingRepairOutcome> {
  const started = Date.now();
  const engineTimeout =
    Number(opts.timeoutMs) || Number(process.env.DRAYMOND_REPAIR_CODEGEN_TIMEOUT_MS) || 120_000;

  // Recourse grounding: verified prior art (registry) + prior lessons, fetched
  // through Axiom's bridge. Best-effort — empty when Axiom/Recourse are offline.
  const grounding = await recourseGroundingBlock(`repair ${job.name}: ${error.slice(0, 200)}`).catch(() => '');
  const prompt = buildRepairPrompt(job, error, lessonHints, grounding);

  // -- 0. Local model (MiniCPM5-2B via llama.cpp) — free first pass ----------
  // Cheap, on-device, zero token cost. Only trusted for a minimal job_config
  // proposal; anything needing real code reasoning falls through to Axiom.
  if (repairLocalEnabled()) {
    const local = await localJobConfigProposal({
      jobName: job.name,
      jobType: job.job_type,
      error,
      jobConfig: job.job_config,
      lessons: lessonHints,
      recourseBlock: grounding,
    });
    if (local) {
      const applied = await tryApplyJobConfigPatch(job, local.content);
      if (applied.applied) {
        return {
          action: 'fixed',
          detail: `local repair (${local.model}) proposed + applied a job_config patch: ${clip(applied.detail, 300)}`,
          dispatch: { kind: 'codegen', engine: local.model, result: local.content, duration_ms: Date.now() - started },
        };
      }
    }
  }

  // -- 1. opencode (primary) ------------------------------------------------
  try {
    const { runOpencodeCodegen } = await import('../ide/opencode-client');
    const result = await runOpencodeCodegen({ prompt, workspace: process.cwd(), timeoutMs: engineTimeout });
    const duration_ms = Date.now() - started;

    if (result.success && result.content.trim()) {
      const content = clip(result.content.trim(), 2000);
      const applied = await tryApplyJobConfigPatch(job, content);
      if (applied.applied) {
        return {
          action: 'fixed',
          detail: `coding crew (${result.model ?? 'opencode'}) proposed + applied a job_config patch: ${clip(applied.detail, 300)}`,
          dispatch: { kind: 'codegen', engine: result.model ?? 'opencode', result: content, duration_ms },
        };
      }
      return {
        action: 'handed-off',
        detail: `coding crew (${result.model ?? 'opencode'}) proposed a fix — ${clip(applied.detail, 300)}`,
        dispatch: { kind: 'codegen', engine: result.model ?? 'opencode', result: content, duration_ms },
      };
    }
    // Fall through to the Uplift Agent when opencode returns nothing usable.
  } catch {
    // Fall through to the Uplift Agent when opencode is unreachable.
  }

  // -- 2. Uplift Agent (codegen fallback per the master coding stack) -------
  if (!opts.skipUplift) {
    const uplift = await dispatchUpliftRepair(job, prompt, engineTimeout);
    if (uplift.ok) {
      const detail = `opencode unavailable — handed repair task ${uplift.taskId} to uplift-agent (fallback)`;
      return {
        action: 'handed-off',
        detail,
        dispatch: { kind: 'codegen', engine: 'uplift-agent', result: detail, duration_ms: Date.now() - started },
      };
    }
  }

  // -- 3. Deterministic terminal plan — never throw, never stall. -----------
  const plan = deterministicRepairPlan(job, error, crew);
  return {
    action: 'escalated',
    detail: `both codegen engines unavailable — ${plan}`,
    dispatch: { kind: 'codegen', engine: 'deterministic', result: plan, duration_ms: Date.now() - started },
  };
}

/**
 * Hand the repair to the Uplift Agent as an async repair task. Best-effort:
 * returns `{ ok: false, error }` on any failure so the caller can degrade to
 * the deterministic plan instead of throwing.
 */
async function dispatchUpliftRepair(
  job: RepairJobLike,
  prompt: string,
  timeoutMs: number,
): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  try {
    const { pingUplift, dispatchTask } = await import('../uplift');
    if (!(await pingUplift())) {
      return { ok: false, error: 'uplift-agent unreachable' };
    }
    const created = await dispatchTask(
      {
        task_id: `repair_${job.id}_${Date.now()}`,
        description: prompt,
        agent: 'uplift-agent',
        context: { job_id: job.id, job_name: job.name, job_type: job.job_type, job_config: job.job_config },
        session_id: 'draymond-repair',
      },
      AbortSignal.timeout(timeoutMs),
    );
    const taskId = (created as { task_id?: unknown } | null)?.task_id;
    return typeof taskId === 'string' && taskId.length > 0
      ? { ok: true, taskId }
      : { ok: false, error: 'uplift-agent task dispatch returned no task_id' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * If the coding crew's reply contains a valid job_config JSON, apply it via the
 * injected updater (the caller passes updateJobConfig through repair-team).
 * This is the "self-healing config" path: opencode fixes the config, Draymond
 * writes it back, the job runs correctly next time.
 */
async function tryApplyJobConfigPatch(
  job: RepairJobLike,
  content: string,
): Promise<{ applied: boolean; detail: string }> {
  // Extract the first JSON object from the reply (covers ```json fences too).
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  const candidate = (fenced?.[1] ?? content).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return { applied: false, detail: 'no JSON object in the fix (proposal only)' };
  }
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { applied: false, detail: 'fix JSON is not an object' };
    }
    // Only apply when it looks like a job_config (has known keys) and we can
    // reach the scheduler's updateJobConfig.
    const keys = Object.keys(parsed);
    const looksLikeConfig = keys.length > 0 && keys.some((k) => ['handler', 'chain_slug', 'chain', 'payload', 'phase', 'url', 'type'].includes(k));
    if (!looksLikeConfig) {
      return { applied: false, detail: 'fix JSON does not look like a job_config' };
    }
    // Safety: only auto-apply when the current config is empty or the patch
    // shares at least one top-level key with it. Prevents an unrelated JSON
    // blob (e.g. {"type": ...}) from silently destroying a real job config.
    const currentKeys = Object.keys(job.job_config);
    const overlapsCurrent = currentKeys.length === 0 || keys.some((k) => currentKeys.includes(k));
    if (!overlapsCurrent) {
      return { applied: false, detail: 'fix JSON does not overlap the current job_config (proposal only)' };
    }
    const { updateJob } = await import('./scheduler');
    await updateJob(job.id, { job_config: parsed as Record<string, unknown> });
    return { applied: true, detail: `wrote job_config: ${clip(JSON.stringify(parsed), 300)}` };
  } catch (err) {
    return { applied: false, detail: `invalid JSON from coding crew: ${err instanceof Error ? err.message : String(err)}` };
  }
}
