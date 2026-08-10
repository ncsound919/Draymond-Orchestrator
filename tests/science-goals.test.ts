import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listGoals,
  getGoal,
  listHypotheses,
  updateGoalStatus,
  updateHypothesisStatus,
  type ScienceGoal,
  type Hypothesis,
} from '@/lib/science/goals';
import { priorityScore, hypothesisMaturity, scoreGoal } from '@/lib/science/priority';

let tmpDir: string;

const GOAL: ScienceGoal = {
  id: 'sports-03',
  domain: 'sports',
  area: 'Biological Load',
  title: 'Real-Time Biological Load Model',
  opportunity: 'Predict fatigue thresholds and injury windows.',
  rationale: 'Solves collapse-before-it-happens.',
  base_weight: 1.0,
  cross_domain_value: 0.8,
  status: 'active',
  model_id: 'sports-03-biological-load',
  hypothesis_ids: ['sports-03-h1'],
};

const HYPS: Hypothesis[] = [
  { id: 'sports-03-h1', goal_id: 'sports-03', claim: 'fatigue precedes injury window', status: 'untested', experiment_ids: [] },
];

describe('science goals + priority', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'science-goals-'));
    process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.DRAYMOND_REGISTRY_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back to the committed seed goals when no operational state exists', async () => {
    const goals = await listGoals();
    expect(goals.length).toBeGreaterThanOrEqual(20);
    const sports03 = goals.find((g) => g.id === 'sports-03');
    expect(sports03).toBeTruthy();
    expect(sports03?.domain).toBe('sports');
  });

  it('seeds and lists goals via the JSON-state file', async () => {
    const { saveGoals, saveHypotheses } = await import('@/lib/science/goals');
    await saveGoals([GOAL]);
    await saveHypotheses(HYPS);
    const goals = await listGoals();
    expect(goals).toHaveLength(1);
    expect(goals[0].id).toBe('sports-03');
    expect(await getGoal('sports-03')).toMatchObject({ model_id: 'sports-03-biological-load' });
    const hyps = await listHypotheses('sports-03');
    expect(hyps).toHaveLength(1);
  });

  it('updates goal status', async () => {
    const { saveGoals } = await import('@/lib/science/goals');
    await saveGoals([GOAL]);
    const updated = await updateGoalStatus('sports-03', 'paused');
    expect(updated?.status).toBe('paused');
    expect((await getGoal('sports-03'))?.status).toBe('paused');
  });

  it('updates hypothesis status', async () => {
    const { saveHypotheses } = await import('@/lib/science/goals');
    await saveHypotheses(HYPS);
    const updated = await updateHypothesisStatus('sports-03-h1', 'supported');
    expect(updated?.status).toBe('supported');
  });

  it('computes hypothesis maturity from statuses', () => {
    expect(hypothesisMaturity([{ ...HYPS[0], status: 'supported' }])).toBe(1.0);
    expect(hypothesisMaturity([{ ...HYPS[0], status: 'in_progress' }])).toBe(0.7);
    expect(hypothesisMaturity([{ ...HYPS[0], status: 'untested' }])).toBe(0.4);
    expect(hypothesisMaturity([{ ...HYPS[0], status: 'refuted' }])).toBe(0.0);
    expect(hypothesisMaturity([])).toBe(0.4);
  });

  it('prioritizes high cross-domain value over low', () => {
    const low: ScienceGoal = { ...GOAL, cross_domain_value: 0.3, base_weight: 0.5 };
    const high: ScienceGoal = { ...GOAL, cross_domain_value: 0.9, base_weight: 1.0 };
    expect(priorityScore({ goal: high, hypotheses: HYPS })).toBeGreaterThan(
      priorityScore({ goal: low, hypotheses: HYPS }),
    );
  });

  it('scoreGoal returns score + maturity', () => {
    const scored = scoreGoal(GOAL, [{ ...HYPS[0], status: 'in_progress' }]);
    expect(scored.maturity).toBe(0.7);
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.score).toBeLessThanOrEqual(1);
  });
});
