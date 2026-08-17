import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  gradeDimensions,
  gradeScore,
  breakthroughClassFor,
  classifyGradeTrend,
  adaptedWeights,
  gradeResearch,
  buildInsights,
  discoveries,
  gradeForGoal,
  DEFAULT_GRADE_WEIGHTS,
} from '@/lib/science/research-grade';
import type { ScienceGoal as GoalType } from '@/lib/science/goals';

let tmpDir: string;

const GOAL: GoalType = {
  id: 'biotech-05',
  domain: 'biotech',
  area: 'Metastasis',
  title: 'Block the molecular pathways that enable cancer spread',
  opportunity: 'Model how metastatic cells survive.',
  rationale: 'Metastasis is the #1 cause of cancer death.',
  base_weight: 1.0,
  cross_domain_value: 0.5,
  status: 'active',
  model_id: 'biotech-05-metastasis',
  hypothesis_ids: ['h1'],
};

const HYP = { id: 'h1', goal_id: 'biotech-05', claim: 'Pathway blockade halts metastatic colonization.', status: 'untested' as const, experiment_ids: [] };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-grade-'));
  process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('research grading dimensions', () => {
  it('scores a frontier-grade goal high when evidence is strong', () => {
    const dims = gradeDimensions({
      goal: GOAL,
      hypotheses: [{ ...HYP, status: 'supported' }],
      papers: [{ id: 'p1', source: 'openalex', title: 'x', url: 'u', year: 2024, authors: 'a', summary: 's' }],
    });
    const score = gradeScore(dims);
    expect(score).toBeGreaterThanOrEqual(600);
    expect(breakthroughClassFor(score)).toMatch(/frontier|promising/);
  });

  it('scores untested low-evidence goals below supported ones', () => {
    const untested = gradeScore(gradeDimensions({ goal: GOAL, hypotheses: [{ ...HYP, status: 'untested' }], papers: [] }));
    const supported = gradeScore(gradeDimensions({ goal: GOAL, hypotheses: [{ ...HYP, status: 'supported' }], papers: [] }));
    expect(untested).toBeLessThan(supported);
    expect(untested).toBeLessThanOrEqual(600);
    expect(supported).toBeGreaterThan(untested);
  });

  it('maps evidence tier to strength', () => {
    expect(gradeDimensions({ goal: GOAL, hypotheses: [{ ...HYP, status: 'supported' }], papers: [] }).evidence).toBe(1.0);
    expect(gradeDimensions({ goal: GOAL, hypotheses: [{ ...HYP, status: 'in_progress' }], papers: [] }).evidence).toBe(0.75);
    expect(gradeDimensions({ goal: GOAL, hypotheses: [{ ...HYP, status: 'untested' }], papers: [] }).evidence).toBe(0.25);
  });

  it('classifies breakthrough bands', () => {
    expect(breakthroughClassFor(800)).toBe('frontier');
    expect(breakthroughClassFor(600)).toBe('promising');
    expect(breakthroughClassFor(400)).toBe('exploratory');
    expect(breakthroughClassFor(100)).toBe('low');
  });

  it('classifies trends from score history', () => {
    expect(classifyGradeTrend([300, 700])).toBe('rising');
    expect(classifyGradeTrend([700, 300])).toBe('falling');
    expect(classifyGradeTrend([500, 510])).toBe('stable');
    expect(classifyGradeTrend([])).toBe('stable');
  });
});

describe('self-learning weight adaptation', () => {
  it('returns default weights with no research lessons', () => {
    const w = adaptedWeights([]);
    expect(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-6);
    expect(w.novelty).toBeCloseTo(0.25);
  });

  it('nudges weights toward dimensions lessons emphasize', () => {
    const w = adaptedWeights([
      { id: 'ls_1', agentId: 'research-grade:biotech', pattern: 'cross-domain transfer', lesson: 'Repeated pattern: cross-domain transfer and frontier novelty', evidenceCount: 3, lastSeen: 'x' },
    ]);
    // crossDomain + novelty both boosted, renormalized.
    expect(w.crossDomain).toBeGreaterThan(0.25);
    expect(w.novelty).toBeGreaterThan(0.25);
    expect(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-6);
  });

  it('ignores lessons from non-research agents', () => {
    const w = adaptedWeights([
      { id: 'ls_2', agentId: 'scheduler:x', pattern: 'cross-domain', lesson: 'cross-domain transfer', evidenceCount: 5, lastSeen: 'x' },
    ]);
    expect(w.crossDomain).toBeCloseTo(DEFAULT_GRADE_WEIGHTS.crossDomain);
    expect(w.novelty).toBeCloseTo(DEFAULT_GRADE_WEIGHTS.novelty);
  });

  it('never drives any dimension to zero, even from a hot lesson', () => {
    const w = adaptedWeights([
      { id: 'ls_3', agentId: 'research-grade:biotech', pattern: 'breakthrough impact evidence supported maturity testable', lesson: 'Repeated pattern: breakthrough impact evidence supported maturity testable cross-domain transfer', evidenceCount: 5, lastSeen: 'x' },
    ]);
    expect(Object.values(w).every((v) => v >= 0.049)).toBe(true);
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
});

describe('gradeResearch full run', () => {
  it('grades active goals and persists state with trends + discoveries', async () => {
    const { saveGoals, saveHypotheses } = await import('@/lib/science/goals');
    await saveGoals([GOAL]);
    await saveHypotheses([{ ...HYP, status: 'supported' }]);

    const run1 = await gradeResearch();
    expect(run1.grades.length).toBe(1);
    expect(run1.grades[0].goalId).toBe('biotech-05');
    expect(run1.grades[0].evidenceTier).toBe('E1');
    expect(run1.discoveries.length).toBe(1);
    expect(run1.insights.some((i) => i.type === 'discovery')).toBe(true);

    // Second run sees prior history for the trend.
    const run2 = await gradeResearch();
    expect(run2.grades[0].trend).toBe('stable');
  });

  it('sorts frontier goals first and exposes them as discoveries', async () => {
    const { saveGoals, saveHypotheses } = await import('@/lib/science/goals');
    await saveGoals([
      { ...GOAL, id: 'low-goal', cross_domain_value: 0.1, base_weight: 0.4 },
      { ...GOAL, id: 'high-goal', cross_domain_value: 0.9, base_weight: 1.0 },
    ]);
    await saveHypotheses([
      { ...HYP, id: 'lh', goal_id: 'low-goal', status: 'untested' },
      { ...HYP, id: 'hh', goal_id: 'high-goal', status: 'supported' },
    ]);
    const { grades } = await gradeResearch();
    const low = grades.find((g) => g.goalId === 'low-goal')!;
    const high = grades.find((g) => g.goalId === 'high-goal')!;
    expect(high.score).toBeGreaterThan(low.score);
    const disc = await discoveries();
    expect(disc[0]!.goalId).toBe('high-goal');
  });

  it('gradeForGoal returns the latest grade or null', async () => {
    expect(await gradeForGoal('biotech-05')).toBeNull();
    await gradeResearch();
    const g = await gradeForGoal('biotech-05');
    expect(g?.goalId).toBe('biotech-05');
  });

  it('buildInsights flags rising trends and low-evidence high-novelty goals', async () => {
    const insights = buildInsights(
      [
        {
          goalId: 'g1', domain: 'biotech', area: 'a', title: 'Rising Frontier', evidenceTier: 'E1', trend: 'rising', score: 800, breakthroughClass: 'frontier',
          dimensions: { novelty: 0.9, testability: 0.8, evidence: 0.3, impact: 0.8, maturity: 0.4, crossDomain: 0.6 },
          hypotheses: [], gradedAt: 'x',
        },
      ],
      { g1: [300, 800] },
    );
    expect(insights.some((i) => i.type === 'trend')).toBe(true);
    expect(insights.some((i) => i.type === 'optimization')).toBe(true);
    expect(insights.some((i) => i.type === 'discovery')).toBe(true);
  });
});
