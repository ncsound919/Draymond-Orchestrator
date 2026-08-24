/**
 * science/goals.ts — System goals + hypotheses registry (JSON-state).
 *
 * Goals and hypotheses live in `.draymond/system-goals.json` and
 * `.draymond/hypotheses.json` (registry JSON-state pattern, no DB). Experiments
 * accumulate results under hypotheses; goals are long-lived objectives.
 */

import { readJsonState, writeJsonState, nowIso } from '@/lib/draymond/cognition';
import fs from 'node:fs';
import path from 'node:path';

export type ScienceDomain = 'biotech' | 'sports';
export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived';
export type HypothesisStatus = 'untested' | 'in_progress' | 'inconclusive' | 'supported' | 'refuted';

export interface ScienceGoal {
  id: string;
  domain: ScienceDomain;
  area: string;
  title: string;
  opportunity: string;
  rationale: string;
  base_weight: number;
  cross_domain_value: number;
  status: GoalStatus;
  model_id: string;
  hypothesis_ids: string[];
}

export interface Hypothesis {
  id: string;
  goal_id: string;
  claim: string;
  status: HypothesisStatus;
  experiment_ids: string[];
}

export interface GoalsState {
  goals: ScienceGoal[];
  updatedAt?: string;
}

export interface HypothesesState {
  hypotheses: Hypothesis[];
  updatedAt?: string;
}

export const GOALS_FILE = 'system-goals';
export const HYPOTHESES_FILE = 'hypotheses';

/** Seed state shipped in the repo; used when the operational .draymond file is absent. */
function seedState(name: string): GoalsState | HypothesesState | null {
  try {
    const file = path.join(process.cwd(), 'src', 'lib', 'science', 'seed', `${name}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as GoalsState | HypothesesState;
  } catch {
    return null;
  }
}

export async function listGoals(): Promise<ScienceGoal[]> {
  const state = await readJsonState<GoalsState>(GOALS_FILE, { goals: [] });
  if ((state.goals ?? []).length > 0) return state.goals;
  const seed = seedState(GOALS_FILE);
  return (seed && (seed as GoalsState).goals) || [];
}

export async function getGoal(id: string): Promise<ScienceGoal | null> {
  const goals = await listGoals();
  return goals.find((g) => g.id === id) ?? null;
}

export async function listHypotheses(goalId?: string): Promise<Hypothesis[]> {
  const state = await readJsonState<HypothesesState>(HYPOTHESES_FILE, { hypotheses: [] });
  let all = state.hypotheses ?? [];
  if (all.length === 0) {
    const seed = seedState(HYPOTHESES_FILE);
    all = (seed && (seed as HypothesesState).hypotheses) || [];
  }
  return goalId ? all.filter((h) => h.goal_id === goalId) : all;
}

export async function getHypothesis(id: string): Promise<Hypothesis | null> {
  const all = await listHypotheses();
  return all.find((h) => h.id === id) ?? null;
}

export async function saveGoals(goals: ScienceGoal[]): Promise<void> {
  await writeJsonState(GOALS_FILE, { goals });
}

export async function saveHypotheses(hypotheses: Hypothesis[]): Promise<void> {
  await writeJsonState(HYPOTHESES_FILE, { hypotheses });
}

export async function updateGoalStatus(id: string, status: GoalStatus): Promise<ScienceGoal | null> {
  const goals = await listGoals();
  const idx = goals.findIndex((g) => g.id === id);
  if (idx === -1) return null;
  goals[idx] = { ...goals[idx], status };
  await saveGoals(goals);
  return goals[idx];
}

export async function updateHypothesisStatus(id: string, status: HypothesisStatus): Promise<Hypothesis | null> {
  const hypotheses = await listHypotheses();
  const idx = hypotheses.findIndex((h) => h.id === id);
  if (idx === -1) return null;
  hypotheses[idx] = { ...hypotheses[idx], status, updatedAt: nowIso() } as Hypothesis;
  await saveHypotheses(hypotheses);
  return hypotheses[idx];
}

export async function linkExperimentToHypothesis(hypothesisId: string, experimentId: string): Promise<void> {
  const hypotheses = await listHypotheses();
  const idx = hypotheses.findIndex((h) => h.id === hypothesisId);
  if (idx === -1) return;
  const ids = hypotheses[idx].experiment_ids ?? [];
  if (!ids.includes(experimentId)) {
    hypotheses[idx] = { ...hypotheses[idx], experiment_ids: [...ids, experimentId] } as Hypothesis;
    await saveHypotheses(hypotheses);
  }
}
