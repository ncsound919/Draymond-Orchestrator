// ============================================================================
// DRAYMOND CODING REPAIR — dispatch the coding crew on a failing job
// ============================================================================
// When a job fails repeatedly, Draymond hands it to the coding crew (opencode
// primary, Uplift Agent fallback) to GENERATE a fix. The fix is returned as a
// structured proposal (patch / config rewrite / command) so the repair team can
// either apply it deterministically or hand it to the crew lead for review.
//
// Token-saving design:
//   - Only dispatched when there is repeated-failure evidence (a lesson) and
//     NOT on cooldown (enforced by repair-team.ts before calling here).
//   - The prompt is small and focused: job config + error + the distilled
//     lesson, not the whole system.
//   - Results are capped in size.
// ============================================================================

import type { RepairCrew } from './repair-team';

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

/** Trim a long result so the repair log stays small. */
function clip(s: string, n = 1200): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/**
 * Run opencode headless to propose a fix for a failing job. Falls back to the
 * Uplift Agent (api_call) when opencode is unreachable. Never throws.
 */
export async function dispatchCodingRepair(
  job: RepairJobLike,
  error: string,
  lessonHints: string[],
  crew: RepairCrew,
): Promise<CodingRepairOutcome> {
  const started = Date.now();

  // 1. Try opencode (primary codegen engine) via the IDE client.
  try {
    const { runOpencodeCodegen } = await import('../ide/opencode-client');
    const prompt = [
      `You are the Draymond coding repair agent. A scheduled job is failing.`,
      ``,
      `JOB: ${job.name} (type: ${job.job_type})`,
      `JOB CONFIG: ${JSON.stringify(job.job_config).slice(0, 800)}`,
      `ERROR: ${error.slice(0, 800)}`,
      lessonHints.length ? `LESSONS (prior repeated failures):\n${lessonHints.join('\n').slice(0, 800)}` : '',
      ``,
      `Diagnose the root cause and propose a concrete, minimal fix.`,
      `If the job_config is wrong, output ONLY the corrected job_config JSON.`,
      `If env/service/config changes are needed, output a short actionable plan.`,
      `Do NOT invent external credentials. Be specific and concise.`,
    ].filter(Boolean).join('\n');

    const result = await runOpencodeCodegen({
      prompt,
      workspace: process.cwd(),
      timeoutMs: Number(process.env.DRAYMOND_REPAIR_CODEGEN_TIMEOUT_MS ?? 120_000),
    });
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
    return {
      action: 'handed-off',
      detail: `coding crew returned no usable fix: ${clip(result.error ?? 'empty', 300)}`,
      dispatch: { kind: 'codegen', engine: 'opencode', result: clip(result.error ?? 'empty', 500), duration_ms },
    };
  } catch (err) {
    return {
      action: 'escalated',
      detail: `opencode unavailable: ${err instanceof Error ? err.message : String(err)} — assign ${crew.lead} manually`,
      dispatch: { kind: 'codegen', engine: 'opencode', result: clip(err instanceof Error ? err.message : String(err), 300), duration_ms: Date.now() - started },
    };
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
    const { updateJob } = await import('./scheduler');
    await updateJob(job.id, { job_config: parsed as Record<string, unknown> });
    return { applied: true, detail: `wrote job_config: ${clip(JSON.stringify(parsed), 300)}` };
  } catch (err) {
    return { applied: false, detail: `invalid JSON from coding crew: ${err instanceof Error ? err.message : String(err)}` };
  }
}
