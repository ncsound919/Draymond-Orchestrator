/**
 * Self-learning — capture outcomes, distill lessons, feed improvements back.
 *
 * Every completed job/QA run/incident can be logged as an outcome; the learning
 * loop clusters them into lessons ("what worked / what broke") that the fleet
 * references on future runs. Deterministic + evidence-based.
 *
 * This module now delegates to the unified learning store (learning-store.ts) —
 * the "one brain" that fleet repair, research-grade, and Benchmark Olympics all
 * share. Public API is preserved so existing consumers compile unchanged.
 */

import {
  addOutcome,
  addOutcomesBatch,
  distillLessonsFromStore,
  lessonsFromStore,
  type Lesson,
  type LearningOutcome,
} from './learning-store';

export type { Lesson, LearningOutcome } from './learning-store';

export async function recordOutcome(input: Omit<LearningOutcome, 'id' | 'createdAt'>): Promise<LearningOutcome> {
  return addOutcome(input);
}

/**
 * Record a benchmark gain as a self-learning outcome. A positive gain is a
 * success (the component improved); a negative gain or a regression is logged
 * so `distillLessons` can cluster repeated regressions into a lesson.
 */
export async function recordBenchmarkGain(input: {
  agentId: string;
  component: string;
  scorer: string;
  baseline: number | null;
  current: number | null;
  gainPct: number | null;
}): Promise<LearningOutcome> {
  return recordOutcome(benchmarkInput(input));
}

/** Record a full set of benchmark gains (one outcome per component+scorer). */
export async function recordBenchmarkGains(
  gains: Array<{
    agentId: string;
    component: string;
    scorer: string;
    baseline: number | null;
    current: number | null;
    gainPct: number | null;
  }>
): Promise<LearningOutcome[]> {
  return addOutcomesBatch(gains.map(benchmarkInput));
}

/** Cluster recent outcomes into lessons. Call nightly. */
export async function distillLessons(limit = 200): Promise<Lesson[]> {
  return distillLessonsFromStore(limit);
}

export async function getLessons(agentId?: string): Promise<Lesson[]> {
  return lessonsFromStore(agentId);
}

function benchmarkInput(input: {
  agentId: string;
  component: string;
  scorer: string;
  baseline: number | null;
  current: number | null;
  gainPct: number | null;
}): Omit<LearningOutcome, 'id' | 'createdAt'> {
  const { agentId, component, scorer, baseline, current, gainPct } = input;
  const gain = gainPct != null ? `${gainPct > 0 ? '+' : ''}${gainPct}%` : 'n/a';
  const detail = `benchmark ${component} ${scorer}: baseline=${baseline ?? 'n/a'} current=${current ?? 'n/a'} gain=${gain}`;
  return {
    agentId,
    kind: 'benchmark',
    summary: `${component} ${scorer} benchmark`,
    success: gainPct != null && gainPct >= 0,
    detail,
  };
}
