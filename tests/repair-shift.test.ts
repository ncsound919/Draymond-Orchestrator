import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmp: string;

const { mockRunBenchmark, mockScheduler, mockRepairTeam, mockServices, mockBenchmarking, mockSelfLearning, mockLearningRepair } = vi.hoisted(() => {
  const cycle = (cls: string) => ({
    componentClass: cls,
    measured: 3,
    recorded: 3,
    queued: 1,
    deepScored: 0,
    weakest: [
      { slug: `weak-${cls}`, score: 82, componentClass: cls },
      { slug: `ok-${cls}`, score: 20, componentClass: cls },
    ],
  });
  return {
    mockRunBenchmark: {
      runBenchmarkCycle: vi.fn().mockImplementation((cls: string) => Promise.resolve(cycle(cls))),
    },
    mockScheduler: {
      listJobs: vi.fn().mockResolvedValue([
        { id: 'j1', name: 'Broken Job', job_type: 'custom', job_config: {}, last_run_status: 'failed', last_error: 'boom' },
        { id: 'j2', name: 'Fine Job', job_type: 'custom', job_config: {}, last_run_status: 'success' },
      ]),
      updateJob: vi.fn().mockResolvedValue(undefined),
    },
    mockRepairTeam: {
      repairFailedJob: vi.fn().mockResolvedValue({ action: 'fixed', jobId: 'j1', jobName: 'Broken Job', failureKind: 'code_error', detail: 'fixed', crew: { lead: 'opencode', members: [], reason: 'x' }, error: 'boom', repairedAt: 'x' }),
      repairWeakEntity: vi.fn().mockResolvedValue({ action: 'fixed', jobId: 'benchmark:x', jobName: 'x', failureKind: 'benchmark_weak', detail: 'fixed', crew: { lead: 'opencode', members: [], reason: 'x' }, error: '', repairedAt: 'x' }),
    },
    mockServices: {
      probeAllServices: vi.fn().mockResolvedValue([
        { slug: 'bookbridge', up: false },
        { slug: 'sports-steve', up: true },
      ]),
      startableDownServices: vi.fn().mockImplementation((down: string[]) => down),
      startDownServices: vi.fn().mockResolvedValue([{ slug: 'bookbridge', up: true, detail: 'started' }]),
    },
    mockBenchmarking: {
      getTrend: vi.fn().mockResolvedValue([82, 40]),
    },
    mockSelfLearning: {
      recordBenchmarkGain: vi.fn().mockResolvedValue({}),
      distillLessons: vi.fn().mockResolvedValue([{ id: 'ls_1', agentId: 'x', pattern: 'p', lesson: 'l', evidenceCount: 2, lastSeen: 'x' }]),
    },
    mockLearningRepair: {
      repairHintsFor: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock('@/lib/draymond/run-benchmark', () => mockRunBenchmark);
vi.mock('@/lib/draymond/scheduler', () => mockScheduler);
vi.mock('@/lib/draymond/repair-team', () => mockRepairTeam);
vi.mock('@/lib/draymond/service-manager', () => mockServices);
vi.mock('@/lib/draymond/benchmarking', () => mockBenchmarking);
vi.mock('@/lib/draymond/self-learning', () => mockSelfLearning);
vi.mock('@/lib/draymond/learning-repair', () => mockLearningRepair);

import { runRepairShift, repairShiftLog } from '../src/lib/draymond/repair-shift';

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-repair-shift-'));
  process.env.DRAYMOND_REGISTRY_DIR = tmp;
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('daily repair shift', () => {
  it('runs the full shift and returns a shaped summary', async () => {
    const result = await runRepairShift({ maxJobs: 5, maxComponents: 3 });
    expect(result.shiftId).toMatch(/^shift_/);
    // Audit: benchmark cycles across all 4 classes.
    expect(mockRunBenchmark.runBenchmarkCycle).toHaveBeenCalledTimes(4);
    expect(result.audit.weakest.length).toBeGreaterThan(0);
    // Only components with score >= 50 are audit targets.
    expect(result.audit.weakest.every((w) => w.score >= 50)).toBe(true);
    // Repair: failed job fixed + weak component fixed + service started.
    expect(mockRepairTeam.repairFailedJob).toHaveBeenCalledTimes(1);
    expect(mockRepairTeam.repairWeakEntity).toHaveBeenCalled();
    expect(mockServices.startDownServices).toHaveBeenCalled();
    // Improvements: gains recorded for acted-on components.
    expect(mockSelfLearning.recordBenchmarkGain).toHaveBeenCalled();
    expect(result.improvements.length).toBeGreaterThan(0);
    // The improvements phase compares shift-over-shift (baseline = prior run,
    // current = this run), never a self-comparison. getTrend mock returns
    // [82, 40] => baseline 82, current 40, gain ~51%.
    const first = result.improvements[0]!;
    expect(first.baseline).toBe(82);
    expect(first.current).toBe(40);
    expect(first.gainPct).toBe(51);
    // Self-learning: lessons distilled.
    expect(mockSelfLearning.distillLessons).toHaveBeenCalled();
    expect(result.lessons).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('dedupes audit targets per class and drops healthy components', async () => {
    mockRunBenchmark.runBenchmarkCycle.mockImplementation((cls: string) =>
      Promise.resolve({
        componentClass: cls,
        measured: 2,
        recorded: 2,
        queued: 0,
        deepScored: 0,
        weakest: [
          { slug: 'shared-weak', score: 90, componentClass: cls },
          { slug: 'healthy', score: 10, componentClass: cls },
        ],
      }),
    );
    const result = await runRepairShift();
    // 'shared-weak' appears once per class (dedupe keyed by class:slug).
    expect(result.audit.weakest.filter((w) => w.slug === 'shared-weak').length).toBe(4);
    expect(result.audit.weakest.some((w) => w.slug === 'healthy')).toBe(false);
  });

  it('skips deep-scoring when skipDeepScore is set', async () => {
    const result = await runRepairShift({ skipDeepScore: true });
    expect(result.audit.deepScored).toBe(0);
    // runBenchmarkCycle for entity gets deepScoreLimit 0.
    const entityCall = mockRunBenchmark.runBenchmarkCycle.mock.calls.find(([cls]) => cls === 'entity');
    expect(entityCall?.[1]?.deepScoreLimit).toBe(0);
  });

  it('survives per-phase failures and records them in failures', async () => {
    mockRunBenchmark.runBenchmarkCycle.mockRejectedValue(new Error('bench down'));
    mockServices.startDownServices.mockRejectedValue(new Error('pm2 down'));
    const result = await runRepairShift();
    expect(result.repair.failures.some((f) => f.includes('audit'))).toBe(true);
    expect(result.repair.failures.some((f) => f.includes('services'))).toBe(true);
    // Still returns a well-formed summary.
    expect(result.shiftId).toBeTruthy();
  });

  it('persists shift history and reads it back', async () => {
    await runRepairShift();
    const log = await repairShiftLog();
    expect(log.length).toBe(1);
    expect(log[0]!.shiftId).toMatch(/^shift_/);
  });
});
