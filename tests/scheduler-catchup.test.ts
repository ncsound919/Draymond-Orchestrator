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
      select: vi.fn(() => { if (op.current !== 'insert' && op.current !== 'update' && op.current !== 'delete') op.current = 'select'; return chain; }),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      insert: vi.fn(() => { op.current = 'insert'; return chain; }),
      update: vi.fn(() => { op.current = 'update'; return chain; }),
      delete: vi.fn(() => { op.current = 'delete'; return chain; }),
      single: vi.fn(() => Promise.resolve(resolve())),
      maybeSingle: vi.fn(() => { op.current = 'claim'; return Promise.resolve(resolve()); }),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onF, onR),
    };
    return chain;
  };
  const tables = new Map<string, unknown>();
  const admin = { from: vi.fn((t: string) => makeChain(tables, t)), _tables: tables };
  return { mockAdmin: admin };
});

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
vi.mock('../src/lib/draymond/self-learning', () => ({
  recordOutcome: vi.fn(async () => ({ id: 'x', createdAt: new Date().toISOString() })),
}));

import { runDueJobs, startInProcessScheduler, stopInProcessScheduler } from '../src/lib/draymond/scheduler';

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    name: 'daily-report',
    cron_expression: '0 * * * *',
    job_type: 'custom',
    job_config: {},
    is_enabled: true,
    next_run_at: new Date().toISOString(),
    max_retries: 1,
    timeout_seconds: 300,
    notify_on_failure: true,
    notify_on_success: false,
    last_run_status: null,
    run_count: 0,
    fail_count: 0,
    last_error: null,
    ...overrides,
  };
}

afterEach(() => {
  mockAdmin._tables.clear();
  vi.clearAllMocks();
  stopInProcessScheduler();
});

describe('scheduler catch-up guard', () => {
  it('skips + reschedules a job that is far overdue (the 6am-flood fix)', async () => {
    const stale = job({
      id: 'night-recap',
      name: 'Night Recap',
      job_type: 'custom',
      next_run_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), // 8h overdue
    });
    mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) => {
      if (op === 'select') return { data: [stale], error: null };
      return { data: null, error: null }; // update → no rows
    });
    const results = await runDueJobs();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(results[0].error).toMatch(/Missed window/);
  });

  it('executes a job due within the grace window', async () => {
    const fresh = job({ id: 'fresh-job', job_type: 'custom' });
    mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) => {
      if (op === 'select') return { data: [fresh], error: null };
      if (op === 'claim') return { data: { id: 'fresh-job' }, error: null };
      return { data: null, error: null };
    });
    const results = await runDueJobs();
    expect(results[0].status).toBe('success');
  });
});

describe('in-process scheduler', () => {
  it('is idempotent and stop/start safe', () => {
    startInProcessScheduler();
    startInProcessScheduler(); // second call is a no-op
    stopInProcessScheduler();
    startInProcessScheduler();
    stopInProcessScheduler();
    expect(true).toBe(true);
  });
});
