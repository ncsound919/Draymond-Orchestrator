import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;

async function importResearchGrade() {
  process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
  return import('@/lib/science/research-grade');
}

async function importStore() {
  process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
  return import('@/lib/draymond/learning-store');
}

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

  it('reads publication events and records graded outcomes', async () => {
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
  });
});
