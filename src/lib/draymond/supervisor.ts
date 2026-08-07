/**
 * Big Homie — task supervisor. Not just "did it run" but "was it done right".
 *
 * A quality gate applied after a task/agent produces output: the supervisor
 * checks the result against acceptance criteria (evidence present, no obvious
 * failure markers) before the result is accepted. Results that fail supervision
 * are rejected back to the worker with a reason.
 */

export interface SupervisionRequest {
  agentId: string;
  task: string;
  output: string;
  /** Required markers (e.g. "evidence", "passed", a section header). */
  requires?: string[];
}

export interface SupervisionVerdict {
  agentId: string;
  task: string;
  approved: boolean;
  reasons: string[];
  checkedAt: string;
}

/** Deterministic acceptance checks (Big Homie enforces quality, not vibes). */
export function supervise(input: SupervisionRequest): SupervisionVerdict {
  const reasons: string[] = [];
  const text = input.output ?? "";

  if (!text || text.trim().length < 20) {
    reasons.push("output too short / empty");
  }
  for (const marker of input.requires ?? []) {
    if (!text.toLowerCase().includes(marker.toLowerCase())) {
      reasons.push(`missing required marker "${marker}"`);
    }
  }
  if (/error|failed|exception|undefined|NaN/.test(text.toLowerCase())) {
    // Only flag as failure if it's the substance, not a "no errors" statement.
    const errs = (text.match(/error|failed|exception/gi) ?? []).length;
    if (errs > (text.toLowerCase().includes("no errors") || text.toLowerCase().includes("no error") ? 1 : 0)) {
      reasons.push(`${errs} error/failure mention(s) in output`);
    }
  }

  return {
    agentId: input.agentId,
    task: input.task,
    approved: reasons.length === 0,
    reasons,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Big Homie agent hook — chain executions can call this after a step completes
 * to gate the result before it feeds the next step.
 */
export async function bigHomieGate(agentId: string, task: string, output: string, requires?: string[]): Promise<SupervisionVerdict> {
  const verdict = supervise({ agentId, task, output, requires });
  // Record the supervision outcome into self-learning for the audit trail.
  try {
    const { recordOutcome } = await import('./self-learning');
    await recordOutcome({
      agentId: 'big-homie',
      kind: 'manual',
      summary: `supervised ${agentId}: ${task.slice(0, 60)}`,
      success: verdict.approved,
      detail: verdict.reasons.join('; ') || 'approved',
    });
  } catch { /* learning store best-effort */ }
  return verdict;
}
