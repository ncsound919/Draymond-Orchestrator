/**
 * Learning → repair feedback — closes the autonomy loop.
 *
 *   failure → repair attempt (recorded) → still failing → loop detected +
 *   escalated → lessons distilled → future repairs consult the lessons.
 *
 * `repairHintsFor` turns repeated-failure lessons into concrete repair hints
 * that the repair team / scheduler consult. `escalateRepairLoops` pushes a
 * real-time alert + incident outcome for any repair that keeps being re-applied
 * without sticking (the failure loop the orchestrator must not let run forever).
 */

import { getLessons } from "./self-learning";
import { detectRepairLoops, type RepairLoopReport } from "./self-repair";
import { publishIssueNotification } from "./ntfy";
import { classifyFailure, type FailureKind } from "./repair-team";

export interface RepairHint {
  /** Agent / component the lesson refers to (e.g. "scheduler:marketing-pulse"). */
  component: string;
  /** Failure signal to route the repair through (e.g. "job:error"). */
  signal: string;
  /** Classified failure kind from the lesson text. */
  kind: FailureKind;
  /** How many outcomes clustered into this lesson. */
  evidenceCount: number;
  /** The distilled lesson text. */
  lesson: string;
  /** Concrete, agent-actionable recommendation. */
  recommendation: string;
}

/** Map a lesson's component/agent id to a repair signal. */
export function lessonSignal(agentId: string, lessonText: string): string {
  if (agentId.startsWith("scheduler:")) return "job:error";
  if (/(monitor|site)/i.test(agentId)) return "monitor:down";
  if (/(qa|test|browser)/i.test(agentId)) return "qa:fail";
  if (/registry|seed/i.test(agentId)) return "registry:stale";
  if (/error|failed|exception|repeated failure/i.test(lessonText)) return "job:error";
  return "escalate";
}

/** Concrete recommendation per classified failure kind. */
export function recommendationForKind(kind: FailureKind): string {
  switch (kind) {
    case "chain_config":
      return "Hand to the coding crew to rewrite job_config (chain → chain_slug) for this job.";
    case "notification_config":
      return "Wrap job_config into { payload: {...} } so the notification validator passes.";
    case "missing_env":
      return "Assign uplift-agent to provision the missing key and document it in .env.example.";
    case "service_down":
      return "overlay-auditor + agent-browser: audit reachability and restart the service.";
    case "code_error":
      return "Hand to the coding crew (Uplift Agent lead) for a patch, supervised by Big Homie.";
    default:
      return "Investigate with omniresearch-pro; escalate if the pattern repeats.";
  }
}

/**
 * Derive actionable repair hints from distilled lessons. Only repeated-failure
 * lessons qualify — evidence, not vibes.
 */
export async function repairHintsFor(agentId?: string): Promise<RepairHint[]> {
  const lessons = await getLessons(agentId);
  return lessons
    .filter((l) => /repeated failure/i.test(l.lesson))
    .map((l) => {
      const kind = classifyFailure(l.lesson);
      return {
        component: l.agentId,
        signal: lessonSignal(l.agentId, l.lesson),
        kind,
        evidenceCount: l.evidenceCount,
        lesson: l.lesson,
        recommendation: recommendationForKind(kind),
      };
    });
}

/**
 * Escalate any repair loops: publish a real-time ntfy alert and record an
 * incident outcome (feeding the next lesson distillation). Returns the loops.
 */
export async function escalateRepairLoops(): Promise<RepairLoopReport[]> {
  const loops = await detectRepairLoops();
  for (const loop of loops) {
    try {
      await publishIssueNotification({
        title: `Draymond · Repair loop on "${loop.signal}"`,
        message:
          `${loop.attempts} auto-repairs for "${loop.signal}" in the loop window ` +
          `(${loop.window.from} → ${loop.window.to}). Last attempt: ${loop.lastDetail}\n\n` +
          `Auto-repair is cooling down — on-call intervention needed.`,
        priority: 5,
        tags: ["rotating_light", "warning"],
      });
    } catch {
      /* best-effort */
    }
    try {
      const { recordOutcome } = await import("./self-learning");
      await recordOutcome({
        agentId: `repair-loop:${loop.signal}`,
        kind: "incident",
        summary: `repair loop: ${loop.signal}`,
        success: false,
        detail: `${loop.attempts} auto-repairs; last: ${loop.lastDetail}`,
      });
    } catch {
      /* best-effort */
    }
  }
  return loops;
}
