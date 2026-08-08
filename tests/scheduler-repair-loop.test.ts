import { afterEach, describe, expect, it, vi } from 'vitest';

// Same client mock pattern as scheduler.test.ts (supabase-compatible chain).
const { mockAdmin } = vi.hoisted(() => {
  const makeChain = (tables: Map<string, unknown>, table: string) => {
    const op = { current: 'select' as string };
    const resolve = () => {
      const entry = tables.get(table);
      if (typeof entry === 'function') return (entry as (o: string) => unknown)(op.current);
      return entry ?? { data: null, error: null };
    };
    const chain = {
      select: vi.fn(() => {
        if (op.current !== 'insert' && op.current !== 'update' && op.current !== 'delete') op.current = 'select';
        return chain;
      }),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      insert: vi.fn(() => { op.current = 'insert'; return chain; }),
      update: vi.fn(() => { op.current = 'update'; return chain; }),
      delete: vi.fn(() => { op.current = 'delete'; return chain; }),
      single: vi.fn(() => Promise.resolve(resolve())),
      maybeSingle: vi.fn(() => { op.current = 'claim'; return Promise.resolve(resolve()); }),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return chain;
  };
  const tables = new Map<string, unknown>();
  const admin = { from: vi.fn((t: string) => makeChain(tables, t)), _tables: tables };
  return { mockAdmin: admin };
});

const learningRepair = vi.hoisted(() => ({
  escalateRepairLoops: vi.fn(async () => [
    { signal: 'monitor:down', attempts: 4, window: { from: 'a', to: 'b' }, lastDetail: 'loop', action: 'escalated' as const },
  ]),
  repairHintsFor: vi.fn(async (agentId: string) => [
    { component: agentId, signal: 'job:error', kind: 'code_error', evidenceCount: 3, lesson: 'Repeated failure: x', recommendation: 'hand off' },
  ]),
}));

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondAdminClient: vi.fn(() => mockAdmin),
}));
vi.mock('../src/lib/draymond/event-bridge', () => ({
  emitJobStarted: vi.fn(),
  emitJobCompleted: vi.fn(),
  emitJobFailed: vi.fn(),
}));
vi.mock('../src/lib/draymond/notifications', () => ({
  sendAlertEmail: vi.fn(async () => ({ id: 'n1' })),
}));
vi.mock('../src/lib/draymond/monitors', () => ({
  checkAllSites: vi.fn(async () => ({ checked_at: '', total: 0, up: 0, down: 0, errors: 0, results: [] })),
}));
vi.mock('../src/lib/draymond/self-repair', () => ({
  attemptRepair: vi.fn(async (signal: string, detail: string) => ({
    id: 'rp_1', detectedAt: new Date().toISOString(), signal,
    action: { name: 'escalate', service: 'x', command: [], safe: false },
    status: 'escalated', detail,
  })),
}));
vi.mock('../src/lib/draymond/learning-repair', () => learningRepair);
vi.mock('../src/lib/draymond/repair-team', () => ({
  repairFailedJob: vi.fn(async (job: { id: string; name: string }, _error: string, _deps: unknown, hints: string[] = []) => ({
    jobId: job.id, jobName: job.name, failureKind: 'code_error', error: 'x',
    crew: { lead: 'uplift-agent', members: [], reason: 'x' },
    action: 'handed-off', detail: 'handed to uplift-agent',
    repairedAt: new Date().toISOString(), lessonHints: hints,
  })),
}));

import { runDueJobs } from '../src/lib/draymond/scheduler';

interface DueJob {
  id: string;
  name: string;
  cron_expression: string;
  job_type: string;
  job_config: { handler: string };
  is_enabled: boolean;
  next_run_at: string;
  max_retries: number;
  timeout_seconds: number;
  notify_on_failure: boolean;
  notify_on_success: boolean;
  last_run_status: string | null;
  run_count: number;
  fail_count: number;
  last_error: string | null;
}

function dueJob(handler: string, name = 'Job'): DueJob {
  return {
    id: 'job-1',
    name,
    cron_expression: '0 * * * *',
    job_type: 'custom',
    job_config: { handler },
    is_enabled: true,
    next_run_at: new Date().toISOString(),
    max_retries: 1,
    timeout_seconds: 300,
    notify_on_failure: false,
    notify_on_success: false,
    last_run_status: null,
    run_count: 0,
    fail_count: 0,
    last_error: null,
  };
}

function setDue(op: string) {
  mockAdmin._tables.set('draymond_scheduled_jobs', (o: string) => {
    if (o === 'select') return { data: [dueJob(op)], error: null };
    if (o === 'claim') return { data: { id: 'job-1' }, error: null };
    return { data: null, error: null };
  });
}

afterEach(() => {
  mockAdmin._tables.clear();
  vi.clearAllMocks();
});

describe('scheduler learning→repair handlers', () => {
  it('self_repair_check escalates repair loops on every pass', async () => {
    setDue('self_repair_check');
    const results = await runDueJobs();
    const output = results[0].output as { loops?: Array<{ signal: string; attempts: number }> };
    expect(results[0].status).toBe('success');
    expect(output.loops).toEqual([{ signal: 'monitor:down', attempts: 4 }]);
    expect(learningRepair.escalateRepairLoops).toHaveBeenCalled();
  });

  it('repair_failed_jobs consults lessons and hands hints to the repair team', async () => {
    const failedJob = dueJob('repair_failed_jobs', 'failing-job');
    failedJob.last_run_status = 'failed';
    failedJob.last_error = 'chain config broken';
    mockAdmin._tables.set('draymond_scheduled_jobs', (o: string) => {
      if (o === 'select') return { data: [failedJob], error: null };
      if (o === 'claim') return { data: { id: 'job-1' }, error: null };
      return { data: null, error: null };
    });

    const results = await runDueJobs();
    const output = results[0].output as {
      failed?: number;
      reports?: Array<{ lessonHints?: string[] }>;
      hintsByJob?: Array<{ job: string; hints: number }>;
    };
    expect(results[0].status).toBe('success');
    expect(output.failed).toBe(1);
    expect(learningRepair.repairHintsFor).toHaveBeenCalledWith('scheduler:failing-job');
    expect(output.reports?.[0].lessonHints).toHaveLength(1);
    expect(output.hintsByJob).toEqual([{ job: 'failing-job', hints: 1 }]);
  });
});
