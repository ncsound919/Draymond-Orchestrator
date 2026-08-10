/**
 * science/priority.ts — Heuristic priority scoring for research goals.
 *
 * Pure function: 0.6*cross_domain_value + 0.3*adapter_availability +
 * 0.1*hypothesis_maturity + base_weight normalizer. Rotation drains ready
 * experiments ordered by priority × hypothesis maturity.
 */

import type { ScienceGoal } from './goals';
import type { Hypothesis } from './goals';

export interface PriorityInput {
  goal: ScienceGoal;
  hypotheses: Hypothesis[];
  /** 0-1: whether a runnable adapter/model exists for this goal's model_id. */
  adapter_availability?: number;
}

/**
 * Compute a 0-1 priority score for a goal.
 * - base_weight (0-1) and cross_domain_value (0-1) come from the goal.
 * - adapter_availability defaults to 0.6 (models are pre-seeded) unless the
 *   caller reports a different value.
 * - hypothesis_maturity: supported=1.0, in_progress=0.7, untested=0.4, refuted=0.
 */
export function hypothesisMaturity(hypotheses: Hypothesis[]): number {
  if (hypotheses.length === 0) return 0.4;
  const scores: Record<string, number> = {
    supported: 1.0,
    in_progress: 0.7,
    untested: 0.4,
    refuted: 0.0,
  };
  return hypotheses.reduce((acc, h) => acc + (scores[h.status] ?? 0.4), 0) / hypotheses.length;
}

export function priorityScore(input: PriorityInput): number {
  const { goal, hypotheses, adapter_availability = 0.6 } = input;
  const maturity = hypothesisMaturity(hypotheses);
  const base = Math.max(0, Math.min(1, goal.base_weight ?? 0.8));
  const cross = Math.max(0, Math.min(1, goal.cross_domain_value ?? 0.5));
  const adapter = Math.max(0, Math.min(1, adapter_availability));
  // Weighted blend: cross-domain value dominates, then adapter availability,
  // then hypothesis maturity. base_weight is a tie-break modifier.
  const score = 0.6 * cross + 0.25 * adapter + 0.15 * maturity;
  return Math.round(Math.min(1, score * (0.7 + 0.3 * base)) * 1000) / 1000;
}

/** Score a goal with its hypotheses resolved. */
export function scoreGoal(
  goal: ScienceGoal,
  hypotheses: Hypothesis[],
  adapter_availability = 0.6
): { goal: ScienceGoal; score: number; maturity: number } {
  return {
    goal,
    score: priorityScore({ goal, hypotheses, adapter_availability }),
    maturity: hypothesisMaturity(hypotheses),
  };
}
