import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureResearchBacklog, seedGoalCampaign, QUEUE_FLOOR } from '@/lib/science/campaigns';
import { enqueueExperiment } from '@/lib/science/experiments';
import type { HypothesisStatus } from '@/lib/science/goals';

const { mockStore } = vi.hoisted(() => ({
  mockStore: { from: vi.fn() },
}));

vi.mock('@/lib/draymond/client', () => ({
  createDraymondClient: () => mockStore,
}));

let tmpDir: string;

/** Create the dataset pool structure the campaign seeder reads. */
function makePool(domain: 'sports' | 'biotech', n: number): string {
  const dir = path.join(tmpDir, 'datasets', domain, 'nba', 'profiles');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(
      path.join(dir, `${i}.json`),
      JSON.stringify({ profile_id: `p${i}`, sport: 'basketball', performance: {}, biometrics: {} }),
      'utf-8'
    );
  }
  return dir;
}

async function seedOneGoal(domain: 'sports' | 'biotech', id: string, hyps: Array<{ id: string; claim: string; status: HypothesisStatus }>) {
  const { saveGoals, saveHypotheses } = await import('@/lib/science/goals');
  await saveGoals([
    { id, domain, area: 'area', title: 'title', opportunity: 'o', rationale: 'r', base_weight: 1, cross_domain_value: 0.8, status: 'active', model_id: `m-${id}`, hypothesis_ids: hyps.map((h) => h.id) },
  ]);
  await saveHypotheses(hyps.map((h) => ({ ...h, goal_id: id, experiment_ids: [] })));
}

describe('science campaigns', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'science-camp-'));
    process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
    process.env.SCIENCE_ROOT = tmpDir;
    mockStore.from.mockReset();
    mockStore.from.mockImplementation(() => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));
  });

  afterEach(() => {
    delete process.env.DRAYMOND_REGISTRY_DIR;
    delete process.env.SCIENCE_ROOT;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seedGoalCampaign enqueues simulation + analysis + translation specs from real profiles', async () => {
    makePool('sports', 6);
    await seedOneGoal('sports', 'sports-03', [{ id: 'h1', claim: 'c', status: 'untested' }]);
    const added = await seedGoalCampaign('sports-03');
    const types = added.map((e) => e.type);
    expect(types).toContain('simulation');
    expect(types).toContain('analysis');
    expect(types).toContain('translation');
    expect(added.length).toBeGreaterThanOrEqual(3);
    // Analysis experiments point at real profile files.
    const analysis = added.find((e) => e.type === 'analysis');
    expect(fs.existsSync(String(analysis?.inputs.dataset ?? ''))).toBe(true);
  });

  it('ensureResearchBacklog seeds back up when the queue runs low', async () => {
    makePool('sports', 8);
    await seedOneGoal('sports', 'sports-03', [{ id: 'h1', claim: 'c', status: 'untested' }]);
    await enqueueExperiment({ goal_id: 'sports-03', domain: 'sports', type: 'simulation', model_id: 'm-sports-03', inputs: {} });
    const r = await ensureResearchBacklog();
    expect(r.queuedBefore).toBe(1);
    expect(r.seededCount).toBeGreaterThan(0);
    expect(r.queuedAfter).toBeGreaterThan(r.queuedBefore);
    expect(r.seededGoals).toContain('sports-03');
  });

  it('ensureResearchBacklog is a no-op when the queue is already healthy', async () => {
    makePool('sports', 8);
    await seedOneGoal('sports', 'sports-03', [{ id: 'h1', claim: 'c', status: 'untested' }]);
    // Queue above floor (10 items) -> no re-seed.
    for (let i = 0; i < 10; i++) {
      await enqueueExperiment({ goal_id: 'sports-03', domain: 'sports', type: 'simulation', model_id: 'm-sports-03', inputs: {} });
    }
    const r = await ensureResearchBacklog();
    expect(r.seededCount).toBe(0);
    expect(r.queuedBefore).toBeGreaterThanOrEqual(QUEUE_FLOOR);
  });

  it('skips goals whose hypotheses are all resolved', async () => {
    makePool('sports', 8);
    await seedOneGoal('sports', 'sports-03', [{ id: 'h1', claim: 'c', status: 'supported' }]);
    const added = await seedGoalCampaign('sports-03');
    expect(added).toHaveLength(0);
  });
});
