// ============================================================================
// REPAIR CREW — Recourse-grounded dispatch to Axiom's verified project loop
// ============================================================================
// The "fixing, not reporting" path. When a code/repo failure can be tied to a
// real workspace, the repair crew hands Axiom a project loop: Axiom edits files,
// runs typecheck + the repo's real tests, verifies against Recourse's sandbox,
// and rolls back on failure. Draymond grounds the goal with Recourse prior art
// (exemplars + lessons) and writes outcomes back so future repairs recall them.
//
// Honest contract: this module only reports `dispatched` when Axiom actually
// accepted a loop id. Axiom owns PASS/FAIL and callback; nothing is marked
// "fixed" here. Every call is fail-soft.
// ============================================================================

import {
  axiomExemplars,
  axiomProjectRepair,
  axiomRecourseContext,
  axiomWriteCodePattern,
  axiomWriteOutcome,
} from './axiom-client';
import { repoRepairEnabled, resolveRepairTargetDir } from './repair-targets';

export interface RepairJobLike {
  id: string;
  name: string;
  job_type?: string;
  job_config?: Record<string, unknown>;
}

export interface ProjectRepairOutcome {
  action: 'handed-off' | 'escalated';
  detail: string;
  dispatch: { kind: string; engine: string; result: string };
}

/** Build the human/agent goal for a failing job. */
function buildGoal(job: RepairJobLike, error: string, lessons: string[]): string {
  return [
    `Repair the failing scheduled job "${job.name}" so it succeeds, keeping the repository's existing tests green.`,
    `Failure: ${error.slice(0, 600)}`,
    lessons.length ? `Prior lessons:\n${lessons.slice(0, 3).join('\n').slice(0, 600)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Best-effort Recourse grounding block for a coding goal: verified prior art
 * (real registry implementations that passed their suites) + prior lessons.
 * Empty string when Axiom/Recourse are offline — never fabricated.
 */
export async function recourseGroundingBlock(goal: string): Promise<string> {
  const parts: string[] = [];
  try {
    const exemplars = await axiomExemplars(goal, { max: 4 });
    if (exemplars.ok && exemplars.block.trim()) {
      parts.push(`Verified prior art (Recourse registry):\n${exemplars.block}`);
    }
  } catch {
    /* best-effort */
  }
  try {
    const context = await axiomRecourseContext(goal);
    if (context.trim()) parts.push(`Prior lessons (Recourse context):\n${context}`);
  } catch {
    /* best-effort */
  }
  return parts.join('\n\n');
}

/**
 * Hand a code/repo failure to Axiom's project loop. Returns null when the job
 * has no resolvable workspace or the feature is disabled (caller falls back to
 * proposal-only repair).
 */
export async function dispatchProjectRepair(input: {
  job: RepairJobLike;
  error: string;
  lessons: string[];
}): Promise<ProjectRepairOutcome | null> {
  if (!repoRepairEnabled()) return null;

  const target = resolveRepairTargetDir({
    name: input.job.name,
    job_type: input.job.job_type,
    job_config: input.job.job_config,
  });
  if (!target) return null;

  const goal = buildGoal(input.job, input.error, input.lessons);
  const grounding = await recourseGroundingBlock(goal);
  const groundedGoal = grounding ? `${goal}\n\n${grounding}` : goal;

  const result = await axiomProjectRepair({
    goal: groundedGoal,
    targetDir: target.targetDir,
    findings: [
      {
        name: input.job.name,
        slug: input.job.id,
        reasons: [input.error.slice(0, 300), ...input.lessons.slice(0, 2)],
      },
    ],
    maxIterations: Number(process.env.DRAYMOND_REPAIR_LOOP_ITERATIONS) || 4,
  });

  if (!result.ok) {
    return {
      action: 'escalated',
      detail: `Axiom project loop unavailable for "${input.job.name}" (${target.source}) — ${result.error ?? 'unknown error'}`,
      dispatch: { kind: 'axiom-project-loop', engine: 'axiom', result: result.error ?? 'unreachable' },
    };
  }

  return {
    action: 'handed-off',
    detail:
      `dispatched Axiom project loop ${result.id} to repair ${target.targetDir} (${target.source}); ` +
      `Axiom runs typecheck + repo tests + Recourse verify and rolls back on failure`,
    dispatch: { kind: 'axiom-project-loop', engine: 'axiom', result: result.id ?? 'started' },
  };
}

/** Best-effort Recourse memory write-back for a repair outcome. */
export async function writeRepairOutcome(input: {
  goal: string;
  status: string;
  targetDir?: string;
  findings?: string[];
  iteration?: number;
  maxIterations?: number;
}): Promise<boolean> {
  try {
    return await axiomWriteOutcome(input);
  } catch {
    return false;
  }
}

/** Promote a verified fix into Recourse as recallable prior art. */
export async function promoteVerifiedPattern(input: {
  name: string;
  goal: string;
  source: string;
  suite?: string;
  domain?: string;
  targetDir?: string;
}): Promise<boolean> {
  try {
    return await axiomWriteCodePattern(input);
  } catch {
    return false;
  }
}
