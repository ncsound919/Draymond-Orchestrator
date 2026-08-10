import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  enqueueExperiment,
  listQueuedExperiments,
  nextExperiment,
  dequeueExperiment,
  runExperiment,
  researchRotation,
} from '@/lib/science/experiments';

let tmpDir: string;

const { mockStore, mockSim, mockPython } = vi.hoisted(() => ({
  mockStore: {
    from: vi.fn(),
  },
  mockSim: {
    runModelById: vi.fn().mockResolvedValue({
      model_id: 'sports-03-biological-load',
      ticks: 48,
      series: [{ tick: 0, fatigue: 0.2 }],
      events_triggered: [],
      final_state: { fatigue: 0.5 },
      outputs: { fatigue: 0.5, injury_risk: 0.4 },
      evidence_tier: 'E1',
    }),
  },
  mockPython: {
    runPythonMetrics: vi.fn().mockResolvedValue({ success: true, data: { data: [{ ter: 30 }] }, error: null, evidence_tier: 'E1' }),
    runPythonInsights: vi.fn().mockResolvedValue({ success: true, data: { data: [{ from_domain: 'sports' }] }, error: null, evidence_tier: 'E3' }),
    runPythonAnalysis: vi.fn().mockResolvedValue({ success: true, data: { data: [{ ter: 30 }] }, error: null, evidence_tier: 'E1' }),
  },
}));

vi.mock('@/lib/science/sim', () => mockSim);
vi.mock('@/lib/sports/pythonExecutors', () => mockPython);
vi.mock('@/lib/biotech/pythonExecutors', () => mockPython);
vi.mock('@/lib/draymond/client', () => ({
  createDraymondClient: () => mockStore,
}));

describe('science experiments', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'science-exp-'));
    process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
    process.env.DRAYMOND_DB_PATH = ':memory:';
    mockStore.from.mockReset();
    mockStore.from.mockImplementation(() => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));
    mockSim.runModelById.mockClear();
  });

  afterEach(() => {
    delete process.env.DRAYMOND_REGISTRY_DIR;
    delete process.env.DRAYMOND_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('enqueues and lists experiments', async () => {
    const spec = {
      goal_id: 'sports-03',
      hypothesis_id: 'sports-03-h1',
      domain: 'sports' as const,
      type: 'simulation' as const,
      model_id: 'sports-03-biological-load',
      inputs: { ticks: 48 },
    };
    const queued = await enqueueExperiment(spec);
    expect(queued.id).toBeTruthy();
    const queue = await listQueuedExperiments();
    expect(queue).toHaveLength(1);
  });

  it('dequeues an experiment by id', async () => {
    const queued = await enqueueExperiment({
      goal_id: 'sports-03',
      domain: 'sports',
      type: 'simulation',
      model_id: 'sports-03-biological-load',
      inputs: {},
    });
    const removed = await dequeueExperiment(queued.id!);
    expect(removed?.id).toBe(queued.id);
    expect(await listQueuedExperiments()).toHaveLength(0);
  });

  it('nextExperiment returns the highest-priority ready experiment', async () => {
    const { saveGoals, saveHypotheses } = await import('@/lib/science/goals');
    await saveGoals([
      { id: 'sports-03', domain: 'sports', area: 'a', title: 't', opportunity: 'o', rationale: 'r', base_weight: 1, cross_domain_value: 0.9, status: 'active', model_id: 'm3', hypothesis_ids: ['h3'] },
      { id: 'sports-01', domain: 'sports', area: 'a', title: 't', opportunity: 'o', rationale: 'r', base_weight: 0.5, cross_domain_value: 0.2, status: 'active', model_id: 'm1', hypothesis_ids: [] },
    ]);
    await saveHypotheses([{ id: 'h3', goal_id: 'sports-03', claim: 'c', status: 'untested', experiment_ids: [] }]);
    await enqueueExperiment({ goal_id: 'sports-03', domain: 'sports', type: 'simulation', model_id: 'm3', inputs: {} });
    await enqueueExperiment({ goal_id: 'sports-01', domain: 'sports', type: 'simulation', model_id: 'm1', inputs: {} });
    const next = await nextExperiment();
    expect(next?.goal_id).toBe('sports-03');
  });

  it('runs a simulation experiment and persists a completed result', async () => {
    const spec = {
      goal_id: 'sports-03',
      hypothesis_id: 'sports-03-h1',
      domain: 'sports' as const,
      type: 'simulation' as const,
      model_id: 'sports-03-biological-load',
      inputs: { ticks: 48 },
    };
    const exp = await runExperiment(spec);
    expect(exp.status).toBe('completed');
    expect(exp.evidence_tier).toBe('E1');
    expect(mockSim.runModelById).toHaveBeenCalledWith('sports-03-biological-load', 48, {});
  });

  it('researchRotation drains the highest-priority ready experiment', async () => {
    const { saveGoals } = await import('@/lib/science/goals');
    await saveGoals([
      { id: 'sports-03', domain: 'sports', area: 'a', title: 't', opportunity: 'o', rationale: 'r', base_weight: 1, cross_domain_value: 0.9, status: 'active', model_id: 'm3', hypothesis_ids: [] },
    ]);
    await enqueueExperiment({ goal_id: 'sports-03', domain: 'sports', type: 'simulation', model_id: 'm3', inputs: {} });
    const result = await researchRotation();
    expect(result.processed).toBe(1);
    expect(result.status).toBe('completed');
    expect(await listQueuedExperiments()).toHaveLength(0);
  });

  it('researchRotation returns processed:0 when queue is empty', async () => {
    const result = await researchRotation();
    expect(result.processed).toBe(0);
  });
});
