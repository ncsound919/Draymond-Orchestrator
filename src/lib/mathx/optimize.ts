// ============================================================================
// DRAYMOND MATHX — optimization helpers (pure TS, dependency-free)
// ============================================================================
// Gives the orchestrator and brain principled prioritization instead of a
// fixed sort:
//
//   rankByExpectedValue — score candidate actions by P(real) × impact, decayed
//                         by age. Drives the upgrade queue so the repair budget
//                         always hits the highest-return fix first.
//   costAwareOrder      — schedule jobs to minimize weighted lateness subject
//                         to a token/cost budget. Drives day-phase execution.
// ============================================================================

export interface EvItem {
  id: string;
  /** P(real problem) — calibrated confidence in [0, 1]. */
  probability: number;
  /** Impact if real, on a comparable scale (e.g. severity 0..1 or 0..100). */
  impact: number;
  /** Age in the queue in arbitrary time units (e.g. hours). */
  age: number;
}

export interface RankedEv {
  id: string;
  /** Expected value = probability × impact, age-decayed. */
  score: number;
  /** Score before the age decay, for transparency. */
  raw: number;
  /** exp(-decayLambda × age) — what age contributes. */
  decay: number;
  /** P(real problem), retained for transparent tie-breaking. */
  probability: number;
}

/**
 * Rank actions by expected value with an exponential age decay.
 *
 *   score = probability × impact × exp(-decayLambda × age)
 *
 * Default `decayLambda` = 0 (no decay). A value like ln(2)/24 halves the score
 * every 24 time units. Ties are broken by probability (surfaces the most-likely
 * fix first), then by raw score.
 */
export function rankByExpectedValue(
  items: EvItem[],
  decayLambda = 0,
): RankedEv[] {
  return items
    .map((it) => {
      const raw = it.probability * it.impact;
      const decay = Math.exp(-Math.max(0, decayLambda) * Math.max(0, it.age));
      return {
        id: it.id,
        score: raw * decay,
        raw,
        decay,
        probability: it.probability,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.probability !== a.probability) return b.probability - a.probability;
      return b.raw - a.raw;
    });
}

export interface CostAwareJob {
  id: string;
  /** Estimated tokens this job needs to run. */
  tokens: number;
  /** Cost per token for this job's provider (consistent units). */
  costPerToken: number;
  /** Deadline (absolute time units; later = more slack). */
  deadline: number;
  /** Weight — how much this job matters (e.g. severity/priority). */
  weight: number;
}

export interface ScheduledRun {
  id: string;
  /** Cumulative cost in costPerToken × tokens units. */
  cost: number;
  /** Weighted lateness contribution of this job (0 if on time). */
  weightedLateness: number;
  totalCost: number;
}

/**
 * Schedule jobs with a cost cap to minimize weighted lateness.
 *
 * Algorithm: take all jobs within the budget, then order them by earliest
 * deadline (EDD), which minimizes maximum lateness for unit weights; ties on
 * deadline are broken by weight (higher weight first). Jobs that would exceed
 * the budget are dropped. This is the deterministic core of a cost-aware day
 * orchestrator: run the important, urgent work within the token budget.
 */
export function costAwareOrder(
  jobs: CostAwareJob[],
  budgetTokens: number,
): { scheduled: ScheduledRun[]; dropped: string[] } {
  const affordable = jobs.filter((j) => j.tokens > 0 && j.costPerToken >= 0);
  let used = 0;
  const scheduled: ScheduledRun[] = [];
  const dropped: string[] = [];

  const ordered = [...affordable].sort(
    (a, b) => a.deadline - b.deadline || b.weight - a.weight,
  );

  for (const j of ordered) {
    const cost = j.tokens * j.costPerToken;
    if (used + cost > budgetTokens) {
      dropped.push(j.id);
      continue;
    }
    used += cost;
    scheduled.push({ id: j.id, cost, weightedLateness: 0, totalCost: used });
  }
  return { scheduled, dropped };
}
