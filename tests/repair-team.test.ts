import { describe, expect, it, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyFailure, assembleCrew, repairFailedJob, renderRepairReport, type RepairReport } from '../src/lib/draymond/repair-team';

// Hermetic env: repairFailedJob → recordRepair + recordOutcome write to the
// file-backed .draymond registry. Without this temp dir, the test fixtures
// (j1–j4, "X" job) pollute the REAL repair-team-log.json + learning-outcomes.json
// and poison the self-learning lessons. See tests/metrics.test.ts for the pattern.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-repair-team-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

// The codegen dispatch path must never hit a real opencode/uplift process in
// tests — stub it to a fast, fixed outcome.
vi.mock('../src/lib/draymond/coding-repair', () => ({
  dispatchCodingRepair: vi.fn(async () => ({
    action: 'handed-off',
    detail: 'coding crew (test mock) proposed a fix',
    dispatch: { kind: 'codegen', engine: 'test-mock', result: 'mock', duration_ms: 1 },
  })),
}));

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('repair team', () => {
  it('classifies chain config failures', () => {
    expect(classifyFailure('chain job missing job_config.chain_slug')).toBe('chain_config');
  });

  it('classifies notification config failures', () => {
    expect(classifyFailure('notification job missing required job_config.payload (recipient, subject, body)')).toBe('notification_config');
  });

  it('assembles a coding crew for config failures', () => {
    const crew = assembleCrew('chain_config');
    expect(crew.lead).toBe('opencode');
    expect(crew.members).toContain('megacode');
    expect(crew.members).toContain('big-homie');
    expect(crew.members).toContain('reporank');
  });

  it('fixes a chain job by rewriting chain -> chain_slug', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const report = await repairFailedJob(
      { id: 'j1', name: 'Evening Marketing Prep', job_type: 'chain', job_config: { chain: 'marketing-pulse' } },
      'chain job missing job_config.chain_slug',
      { updateJobConfig: async (id, config) => { updates.push(config); } },
    );
    expect(report.action).toBe('fixed');
    expect(updates[0]!.chain_slug).toBe('marketing-pulse');
    expect(updates[0]!).not.toHaveProperty('chain');
  });

  it('fixes a notification job by wrapping type into payload', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const report = await repairFailedJob(
      { id: 'j2', name: 'Daily Health Digest', job_type: 'notification', job_config: { type: 'health_summary' } },
      'notification job missing required job_config.payload',
      { updateJobConfig: async (id, config) => { updates.push(config); } },
    );
    expect(report.action).toBe('fixed');
    expect(updates[0]!.payload).toEqual({ type: 'health_summary' });
  });

  it('escalates missing-env failures to the crew lead', async () => {
    const report = await repairFailedJob(
      { id: 'j3', name: 'X', job_type: 'custom', job_config: {} },
      'NEWSAPI_KEY not configured',
      { updateJobConfig: async () => {} },
    );
    expect(report.action).toBe('escalated');
    expect(report.failureKind).toBe('missing_env');
  });

  it('carries distilled lesson hints into the repair report', async () => {
    const report = await repairFailedJob(
      { id: 'j4', name: 'Evening Marketing Prep', job_type: 'chain', job_config: { chain: 'marketing-pulse' } },
      'chain job missing job_config.chain_slug',
      { updateJobConfig: async () => {} },
      ['Repeated failure: "Evening Marketing Prep" (3/3).'],
    );
    expect(report.lessonHints).toEqual(['Repeated failure: "Evening Marketing Prep" (3/3).']);
  });

  it('dispatches the coding crew immediately on the FIRST code_error (no evidence needed)', async () => {
    const report = await repairFailedJob(
      { id: 'j5', name: 'Evening Marketing Prep', job_type: 'custom', job_config: {} },
      'Scheduler job threw an error while running',
      { updateJobConfig: async () => {} },
    );
    expect(report.action).toBe('handed-off');
    expect(report.dispatch?.kind).toBe('codegen');
    expect((report.dispatch as { engine?: string }).engine).toBe('test-mock');
  });

  it('defers a repeated code_error while the per-job cooldown is active', async () => {
    const job = { id: 'j6', name: 'Evening Marketing Prep', job_type: 'custom', job_config: {} };
    const first = await repairFailedJob(job, 'Scheduler job threw an error while running', { updateJobConfig: async () => {} });
    expect(first.dispatch?.kind).toBe('codegen');
    const second = await repairFailedJob(job, 'Scheduler job threw an error while running', { updateJobConfig: async () => {} });
    expect(second.action).toBe('handed-off');
    expect(second.dispatch?.kind).toBe('deferred');
  });

  it('renders a deterministic, LLM-free repair report', () => {
    const report: RepairReport = {
      jobId: 'j7',
      jobName: 'Evening Marketing Prep',
      failureKind: 'chain_config',
      error: 'chain job missing job_config.chain_slug',
      crew: { lead: 'opencode', members: ['big-homie', 'reporank'], reason: 'x' },
      action: 'fixed',
      detail: 'rewrote job_config: chain -> chain_slug',
      repairedAt: '2026-08-09T00:00:00.000Z',
      lessonHints: ['Repeated failure (3/3).'],
      dispatch: { kind: 'service_start', result: 'started bookbridge' },
    };
    const text = renderRepairReport(report);
    expect(text).toContain('Draymond Repair Report');
    expect(text).toContain('Evening Marketing Prep');
    expect(text).toContain('Chain config');
    expect(text).toContain('FIXED');
    expect(text).toContain('opencode + big-homie, reporank');
    expect(text).toContain('rewrote job_config: chain -> chain_slug');
  });
});
