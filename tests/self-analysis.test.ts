import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-self-analysis-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getHeartbeats: vi.fn(),
    repairLog: vi.fn(),
    detectRepairLoops: vi.fn(),
    listJobs: vi.fn(),
    getCostSummary: vi.fn(),
    logEvent: vi.fn(async () => {}),
  },
}));

vi.mock('../src/lib/draymond/heartbeat', () => ({ getHeartbeats: mocks.getHeartbeats }));
vi.mock('../src/lib/draymond/self-repair', () => ({
  repairLog: mocks.repairLog,
  detectRepairLoops: mocks.detectRepairLoops,
}));
vi.mock('../src/lib/draymond/scheduler', () => ({ listJobs: mocks.listJobs }));
vi.mock('../src/lib/draymond/analytics', () => ({ getCostSummary: mocks.getCostSummary }));
vi.mock('../src/lib/draymond/index', () => ({ logEvent: mocks.logEvent }));

import {
  normalizeTitle,
  findingHash,
  escalatedSeverity,
  analyzeFleet,
  analyzeRevenue,
  analyzeLearning,
  runSelfAnalysis,
  selfAnalysisState,
} from '../src/lib/draymond/self-analysis';
import { readLearningStore } from '../src/lib/draymond/learning-store';

function writeBrain(name: string, data: unknown): void {
  fs.writeFileSync(path.join(tmp, `${name}.json`), JSON.stringify(data, null, 2), 'utf-8');
}

function clearBrain(): void {
  for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { force: true });
}

beforeEach(() => {
  clearBrain();
  vi.clearAllMocks();
  mocks.getHeartbeats.mockResolvedValue({});
  mocks.repairLog.mockResolvedValue([]);
  mocks.detectRepairLoops.mockResolvedValue([]);
  mocks.listJobs.mockResolvedValue([]);
  mocks.getCostSummary.mockResolvedValue(null);
});

describe('pure helpers', () => {
  it('normalizeTitle collapses case, whitespace, and repeat counters', () => {
    expect(normalizeTitle('  Fleet Service Down:  X  ')).toBe('fleet service down: x');
    expect(normalizeTitle('Repair signal escalates: monitor:down (167x)')).toBe('repair signal escalates: monitor:down (Nx)');
  });

  it('findingHash keys on category + normalized title', () => {
    expect(findingHash('fleet', 'Fleet service down: X')).toBe('fleet:fleet service down: x');
    expect(findingHash('fleet', 'FLEET service down: X')).toBe(findingHash('fleet', 'Fleet Service Down: X'));
  });

  it('escalatedSeverity escalates after the threshold and never exceeds critical', () => {
    expect(escalatedSeverity('info', 1, 3)).toBe('info');
    expect(escalatedSeverity('info', 3, 3)).toBe('warn');
    expect(escalatedSeverity('warn', 3, 3)).toBe('critical');
    expect(escalatedSeverity('critical', 10, 3)).toBe('critical');
    expect(escalatedSeverity('warn', 1, 3)).toBe('warn');
  });
});

describe('analyzeFleet', () => {
  it('flags down services as critical and stale heartbeats as warn', async () => {
    const now = new Date();
    mocks.getHeartbeats.mockResolvedValue({
      'uplift-agent': { slug: 'uplift-agent', name: 'Uplift Agent', last_seen: now.toISOString(), up: false, detail: 'fetch failed' },
      'sports-steve': { slug: 'sports-steve', name: 'Sports Steve', last_seen: new Date(now.getTime() - 5 * 60 * 60_000).toISOString(), up: true, detail: 'HTTP 200' },
      'mutly': { slug: 'mutly', name: 'Mutly', last_seen: now.toISOString(), up: true, detail: 'HTTP 200' },
    });
    const { hits, stats } = await analyzeFleet();
    expect(stats).toEqual({ total: 3, up: 1, down: 1, stale: 1 });
    const down = hits.find((h) => h.category === 'fleet' && h.title.startsWith('Fleet service down'));
    const stale = hits.find((h) => h.category === 'fleet' && h.title.startsWith('Fleet heartbeat stale'));
    expect(down?.severity).toBe('critical');
    expect(stale?.severity).toBe('warn');
  });
});

describe('analyzeRevenue', () => {
  it('flags a stale treasury pulse as warn', async () => {
    writeBrain('treasury', {
      revenueCents: 0,
      charges: {},
      lastPulseAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    const { hits } = await analyzeRevenue();
    expect(hits.some((h) => h.title === 'Revenue pulse stale')).toBe(true);
  });

  it('flags recent-but-zero revenue as info', async () => {
    writeBrain('treasury', {
      revenueCents: 0,
      charges: {},
      lastPulseAt: new Date().toISOString(),
    });
    const { hits } = await analyzeRevenue();
    expect(hits.some((h) => h.title === 'No settled revenue recorded')).toBe(true);
    expect(hits.find((h) => h.title === 'Revenue pulse stale')).toBeUndefined();
  });
});

describe('analyzeLearning', () => {
  it('flags drift, stale weights, and a high outcome failure rate', async () => {
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    writeBrain('learning-store', {
      outcomes: [
        { id: 'o1', agentId: 'a', kind: 'job', summary: 'night sync', success: false, detail: '', createdAt: ago(0) },
        { id: 'o2', agentId: 'a', kind: 'job', summary: 'night sync', success: false, detail: '', createdAt: ago(0) },
        { id: 'o3', agentId: 'a', kind: 'job', summary: 'night sync', success: false, detail: '', createdAt: ago(0) },
      ],
      lessons: [],
      gradeWeights: null,
      benchmarkWeights: { speedAndLatency: 0.3, securityAndDefense: 0.2, reliabilityAndSla: 0.3, costAndEfficiency: 0.2, lastRecalibratedAt: ago(30), recalibrationReason: 'test' },
      driftMetrics: { conceptDriftDetected: true, covariateShiftDetected: false, driftMagnitude: 0.42, shiftedFeatures: ['latency'], recommendedAction: 'recalibrate', lastEvaluatedAt: ago(0) },
      discoveries: [],
      publicationEvents: [],
      updatedAt: new Date().toISOString(),
    });
    const { hits } = await analyzeLearning();
    const titles = hits.map((h) => h.title);
    expect(titles).toContain('Benchmark drift detected');
    expect(titles).toContain('Benchmark weights stale');
    expect(titles).toContain('High outcome failure rate');
  });

  it('returns empty hits when the store is absent', async () => {
    const { hits } = await analyzeLearning();
    expect(hits).toEqual([]);
  });
});

describe('runSelfAnalysis loop', () => {
  it('never rejects and returns a well-formed report even with no telemetry', async () => {
    const report = await runSelfAnalysis();
    expect(report.ranAt).toBeTruthy();
    expect(report.findings).toEqual([]);
    expect(report.recommendations).toEqual([]);
    expect(Array.isArray(report.errors)).toBe(true);
  });

  it('closes the loop: an active finding becomes resolved and is recorded as an outcome', async () => {
    // Run 1 — a service is down.
    mocks.getHeartbeats.mockResolvedValue({
      'uplift-agent': { slug: 'uplift-agent', name: 'Uplift Agent', last_seen: new Date().toISOString(), up: false, detail: 'fetch failed' },
    });
    const first = await runSelfAnalysis();
    expect(first.findings.some((f) => f.status === 'active' && f.category === 'fleet')).toBe(true);
    expect(first.recommendations.length).toBeGreaterThan(0);
    expect(first.recommendations[0]!.proposedAction.length).toBeGreaterThan(10);

    // Run 2 — the service is healthy again.
    mocks.getHeartbeats.mockResolvedValue({
      'uplift-agent': { slug: 'uplift-agent', name: 'Uplift Agent', last_seen: new Date().toISOString(), up: true, detail: 'HTTP 200' },
    });
    const second = await runSelfAnalysis();
    expect(second.resolved.length).toBe(1);
    expect(second.resolved[0]!.title).toContain('Fleet service down');
    expect(second.recommendations.length).toBe(0);

    // Closed loop: the resolved finding landed in the learning store as an outcome.
    const store = await readLearningStore();
    expect(store.outcomes.some((o) => o.summary.startsWith('self-analysis resolved'))).toBe(true);

    // State persists across runs.
    const { latest } = await selfAnalysisState();
    expect(latest?.id).toBe(second.id);
  });

  it('persists a recurring finding and escalates its severity across runs', async () => {
    const staleHeartbeat = (name: string, slug: string) => ({
      [slug]: { slug, name, last_seen: new Date(Date.now() - 5 * 60 * 60_000).toISOString(), up: true, detail: 'HTTP 200' },
    });
    mocks.getHeartbeats.mockResolvedValue(staleHeartbeat('Mutly', 'mutly'));
    const first = await runSelfAnalysis();
    const f1 = first.findings.find((f) => f.title.startsWith('Fleet heartbeat stale'))!;
    expect(f1.severity).toBe('warn');

    // Two more runs keep the same finding and escalate to critical.
    await runSelfAnalysis();
    const third = await runSelfAnalysis();
    const f3 = third.findings.find((f) => f.title.startsWith('Fleet heartbeat stale'))!;
    expect(f3.occurrences).toBe(3);
    expect(f3.severity).toBe('critical');
    expect(f3.id).toBe(f1.id);
  });
});