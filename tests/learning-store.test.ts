import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Must import AFTER env is set so the store resolves the temp dir.
let tmpDir: string;

async function importStore() {
  process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
  return import('@/lib/draymond/learning-store');
}

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `ls-test-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('learning-store', () => {
  it('returns an empty default store on first read', async () => {
    const s = await importStore();
    const store = await s.readLearningStore();
    expect(store.outcomes).toEqual([]);
    expect(store.lessons).toEqual([]);
    expect(store.gradeWeights).toBeNull();
    expect(store.discoveries).toEqual([]);
    expect(store.publicationEvents).toEqual([]);
  });

  it('round-trips weights, discoveries, and publication events', async () => {
    const s = await importStore();
    const gw = { novelty: 0.3, testability: 0.1, evidence: 0.25, impact: 0.2, maturity: 0.05, crossDomain: 0.1 };
    await s.saveGradeWeights(gw);
    await s.savePublicationEvent({
      id: 'pe_1', goalId: 'g1', discoveryId: 'd1', source: 'curemind',
      publishedAt: new Date().toISOString(), gradeScore: 800, outcome: 'success',
    });
    const store = await s.readLearningStore();
    expect(store.gradeWeights).toEqual(gw);
    expect(store.publicationEvents).toHaveLength(1);
    expect(store.publicationEvents[0].goalId).toBe('g1');
  });

  it('adds an outcome and distills from the store', async () => {
    const s = await importStore();
    await s.addOutcome({ agentId: 'a', kind: 'job', summary: 'x failed twice', success: false, detail: 'err' });
    await s.addOutcome({ agentId: 'a', kind: 'job', summary: 'x failed twice', success: false, detail: 'err2' });
    const lessons = await s.distillLessonsFromStore();
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons[0].lesson).toMatch(/Repeated failure/i);
  });
});
