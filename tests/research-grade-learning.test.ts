import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ResearchGrade } from '@/lib/science/research-grade';
import type { ScienceGoal } from '@/lib/science/goals';

let tmpDir: string;

async function importResearchGrade() {
  process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
  return import('@/lib/science/research-grade');
}

async function importStore() {
  process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
  return import('@/lib/draymond/learning-store');
}

function grade(partial: Partial<ResearchGrade> & { goalId: string; score: number; breakthroughClass: ResearchGrade['breakthroughClass'] }): ResearchGrade {
  return {
    goalId: partial.goalId,
    domain: partial.domain ?? 'biotech',
    area: partial.area ?? 'Metastasis',
    title: partial.title ?? 'Untitled',
    dimensions: partial.dimensions ?? { novelty: 0.5, testability: 0.5, evidence: 0.5, impact: 0.5, maturity: 0.5, crossDomain: 0.5 },
    score: partial.score,
    evidenceTier: partial.evidenceTier ?? 'E1',
    breakthroughClass: partial.breakthroughClass,
    trend: partial.trend ?? 'stable',
    hypotheses: partial.hypotheses ?? [],
    gradedAt: partial.gradedAt ?? new Date().toISOString(),
  };
}

const GOAL: ScienceGoal = {
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

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `rg-test-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  vi.unstubAllGlobals();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('research-grade self-learning integration', () => {
  it('persists adapted grade weights to the store', async () => {
    const rg = await importResearchGrade();
    const store = await importStore();
    await rg.persistGradeWeightsForLearning(rg.DEFAULT_GRADE_WEIGHTS);
    const s = await store.readLearningStore();
    expect(s.gradeWeights).toEqual(rg.DEFAULT_GRADE_WEIGHTS);
  });

  it('mirrors only frontier/promising discoveries into the store', async () => {
    const rg = await importResearchGrade();
    const store = await importStore();
    await rg.mirrorDiscoveriesForLearning([
      grade({ goalId: 'frontier-1', score: 880, breakthroughClass: 'frontier' }),
      grade({ goalId: 'promising-1', score: 640, breakthroughClass: 'promising' }),
      grade({ goalId: 'exploratory-1', score: 400, breakthroughClass: 'exploratory' }),
      grade({ goalId: 'low-1', score: 100, breakthroughClass: 'low' }),
    ]);
    const s = await store.readLearningStore();
    expect(s.discoveries).toHaveLength(2);
    const ids = s.discoveries.map((d) => d.goalId).sort();
    expect(ids).toEqual(['frontier-1', 'promising-1']);
    // Slim store shape — no grading internals leaked.
    expect(s.discoveries[0]).not.toHaveProperty('dimensions');
    expect(s.discoveries[0]).not.toHaveProperty('hypotheses');
    expect(s.discoveries[0]).toHaveProperty('gradedAt');
  });

  it('upserts per-grade so route-posted discoveries survive a mirror run (no clobber)', async () => {
    const rg = await importResearchGrade();
    const store = await importStore();
    // A discovery posted via the discovery HTTP route: non-frontier, and NOT in
    // the current frontier/promising set — a whole-array replace would delete it.
    await store.upsertDiscovery({
      goalId: 'route-seeded',
      domain: 'biotech', area: 'CureMind', title: 'route-posted candidate',
      score: 480, evidenceTier: 'E2', breakthroughClass: 'exploratory',
      trend: 'stable', gradedAt: new Date().toISOString(),
    });

    await rg.mirrorDiscoveriesForLearning([
      grade({ goalId: 'frontier-1', score: 880, breakthroughClass: 'frontier' }),
      grade({ goalId: 'promising-1', score: 640, breakthroughClass: 'promising' }),
    ]);

    const s = await store.readLearningStore();
    const ids = s.discoveries.map((d) => d.goalId).sort();
    // Both the route-posted entry and the freshly graded ones survive.
    expect(ids).toEqual(['frontier-1', 'promising-1', 'route-seeded']);
    expect(s.discoveries).toHaveLength(3);
  });

  it('records graded outcomes once per publication event, idempotently', async () => {
    const rg = await importResearchGrade();
    const store = await importStore();
    await store.savePublicationEvent({
      id: 'pe_1', goalId: 'g1', discoveryId: 'd1', source: 'curemind',
      publishedAt: new Date().toISOString(), gradeScore: 820, outcome: 'success',
    });
    await store.savePublicationEvent({
      id: 'pe_2', goalId: 'g2', discoveryId: 'd2', source: 'curemind',
      publishedAt: new Date().toISOString(), gradeScore: 200, outcome: 'low_grade_published',
    });

    const outcomes = await rg.recordPublicationOutcomes();
    expect(outcomes.length).toBe(2);
    expect(outcomes[0].success).toBe(true);
    expect(outcomes[1].success).toBe(false);
    expect(outcomes[0].agentId).toBe('research-grade:published');
    expect(outcomes[0].kind).toBe('benchmark');

    // Outcomes are persisted in the store.
    let s = await store.readLearningStore();
    expect(s.outcomes).toHaveLength(2);
    expect(s.outcomes[0].success).toBe(true);
    expect(s.outcomes[1].success).toBe(false);
    expect(s.consumedPublicationEventIds).toEqual(['pe_1', 'pe_2']);

    // Second run records nothing new — consumption is idempotent.
    const second = await rg.recordPublicationOutcomes();
    expect(second).toHaveLength(0);
    s = await store.readLearningStore();
    expect(s.outcomes).toHaveLength(2);
  });

  it('reads store-prior weights and pushes them back through a real gradeResearch run', async () => {
    const rg = await importResearchGrade();
    const store = await importStore();
    const customWeights = { novelty: 0.4, testability: 0.05, evidence: 0.35, impact: 0.1, maturity: 0.05, crossDomain: 0.05 };
    await store.saveGradeWeights(customWeights);

    const { saveGoals, saveHypotheses } = await import('@/lib/science/goals');
    await saveGoals([GOAL]);
    await saveHypotheses([{ ...HYP, status: 'supported' }]);

    const result = await rg.gradeResearch();
    expect(result.grades.length).toBe(1);

    const s = await store.readLearningStore();
    // No research lessons yet → weights carry the stored prior forward unchanged.
    expect(s.gradeWeights).toEqual(customWeights);
    // The frontier goal is mirrored into the shared discoveries surface.
    expect(s.discoveries.some((d) => d.goalId === 'biotech-05')).toBe(true);
  });
});
