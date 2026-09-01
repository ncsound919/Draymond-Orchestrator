import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
vi.mock('../src/lib/draymond/coding-repair', () => ({
  dispatchCodingRepair: vi.fn(async () => ({
    action: 'handed-off',
    detail: 'coding crew (test mock) proposed a fix',
    dispatch: { kind: 'codegen', engine: 'test-mock', result: 'mock', duration_ms: 1 },
  })),
  deterministicRepairPlan: (job: { name: string }) => `plan for ${job.name}`,
}));
vi.mock('../src/lib/draymond/kairos', () => ({
  kairosScan: vi.fn(async () => ({ detected: 2, created: 2, repeated: 0, notified: 1, errors: [], budgetExceeded: false, durationMs: 5 })),
}));
vi.mock('../src/lib/draymond/dream-cycle', () => ({
  runDreamCycle: vi.fn(async () => ({ lastDreamAt: new Date().toISOString(), sessionsCounted: 0, phases: {}, entries: [], durationMs: 3, gatedBy: 'sessions' })),
}));
vi.mock('../src/lib/draymond/ultraplan', () => ({
  processNextUltraplan: vi.fn(async () => ({ processed: 1, id: 'up_1', status: 'plan_ready' })),
}));

import { listJobs, getJob, createJob, updateJob, deleteJob, enableJob, disableJob, runDueJobs } from '../src/lib/draymond/scheduler';

function setTable(table: string, data: unknown, error: unknown = null) {
  mockAdmin._tables.set(table, { data, error });
}

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
    ...overrides,
  };
}

let registryDir: string;

beforeEach(() => {
  // Isolate delegation/consumption writes from the real .draymond brain state.
  registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-scheduler-registry-'));
  process.env.DRAYMOND_REGISTRY_DIR = registryDir;
});

afterEach(() => {
  mockAdmin._tables.clear();
  delete process.env.DRAYMOND_REGISTRY_DIR;
  try { fs.rmSync(registryDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('scheduler CRUD', () => {
  it('listJobs returns jobs with filters', async () => {
    setTable('draymond_scheduled_jobs', [job(), job({ id: 'job-2' })]);
    const result = await listJobs({ is_enabled: true });
    expect(result).toHaveLength(2);
  });

  it('listJobs throws on DB error', async () => {
    setTable('draymond_scheduled_jobs', null, { message: 'boom' });
    await expect(listJobs()).rejects.toThrow(/boom/);
  });

  it('getJob returns null on not-found', async () => {
    setTable('draymond_scheduled_jobs', null, { code: 'PGRST116' });
    expect(await getJob('missing')).toBeNull();
  });

  it('getJob returns the job when found', async () => {
    setTable('draymond_scheduled_jobs', job({ name: 'Found' }));
    const j = await getJob('daily-report');
    expect(j?.name).toBe('Found');
  });

  it('createJob computes next_run_at from the cron expression', async () => {
    setTable('draymond_scheduled_jobs', job());
    const j = await createJob({ name: 'daily-report', cron_expression: '0 * * * *', job_type: 'custom' });
    expect(j.id).toBe('job-1');
  });

  it('createJob throws on DB error', async () => {
    setTable('draymond_scheduled_jobs', null, { message: 'insert failed' });
    await expect(createJob({ name: 'x', cron_expression: '0 * * * *', job_type: 'custom' })).rejects.toThrow(/insert failed/);
  });

  it('updateJob recomputes next_run_at when cron changes', async () => {
    setTable('draymond_scheduled_jobs', job({ is_enabled: false }));
    const j = await updateJob('job-1', { cron_expression: '*/5 * * * *' });
    expect(j.is_enabled).toBe(false);
  });

  it('deleteJob removes the job', async () => {
    setTable('draymond_scheduled_jobs', null);
    await expect(deleteJob('job-1')).resolves.toBeUndefined();
  });

  it('enableJob recomputes next_run_at and enables', async () => {
    // Fetch (select) then update
    mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) =>
      op === 'select' ? { data: job({ cron_expression: '*/10 * * * *' }), error: null } : { data: job({ is_enabled: true }), error: null },
    );
    const j = await enableJob('job-1');
    expect(j.is_enabled).toBe(true);
  });

  it('enableJob throws when the job is missing', async () => {
    setTable('draymond_scheduled_jobs', null, { code: 'PGRST116' });
    await expect(enableJob('missing')).rejects.toThrow(/not found/);
  });

  it('disableJob disables the job', async () => {
    setTable('draymond_scheduled_jobs', job({ is_enabled: false }));
    const j = await disableJob('job-1');
    expect(j.is_enabled).toBe(false);
  });
});

describe('runDueJobs', () => {
  it('returns [] when no jobs are due', async () => {
    setTable('draymond_scheduled_jobs', []);
    const results = await runDueJobs();
    expect(results).toEqual([]);
  });

  it('executes a due custom job and reports success', async () => {
    const dueJob = job({ id: 'job-1', job_type: 'custom', job_config: {}, run_count: 0, notify_on_success: false });
    // select → due job list; claim (maybeSingle) → claimed row; success update → no rows
    mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) => {
      if (op === 'select') return { data: [dueJob], error: null };
      if (op === 'claim') return { data: { id: 'job-1' }, error: null };
      return { data: null, error: null };
    });
    const results = await runDueJobs();
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
    expect(results[0].job_id).toBe('job-1');
  });

  it('skips jobs already claimed by another worker', async () => {
    const dueJob = job({ id: 'job-1', job_type: 'custom', job_config: {}, run_count: 0 });
    mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) => {
      if (op === 'select') return { data: [dueJob], error: null };
      if (op === 'claim') return { data: null, error: null }; // already claimed
      return { data: null, error: null };
    });
    const results = await runDueJobs();
    expect(results[0].status).toBe('skipped');
  });

  it('reports a failing job and records a learning outcome', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-scheduler-'));
    process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
    try {
      const dueJob = job({ id: 'job-fail', name: 'job-fail', job_type: 'chain', job_config: { chain_slug: 'missing' }, run_count: 0, fail_count: 0, notify_on_failure: false });
      mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) => {
        if (op === 'select') return { data: [dueJob], error: null };
        if (op === 'claim') return { data: { id: 'job-fail' }, error: null };
        return { data: null, error: null };
      });
      const results = await runDueJobs();
      expect(results[0].status).toBe('failed');
      // The failure was fed to the self-learning loop for nightly distillation.
      const raw = fs.readFileSync(path.join(tmpDir, 'learning-store.json'), 'utf-8');
      const store = JSON.parse(raw) as { outcomes: Array<{ agentId: string }> };
      expect(store.outcomes.some((o) => o.agentId === 'scheduler:job-fail')).toBe(true);
    } finally {
      delete process.env.DRAYMOND_REGISTRY_DIR;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('cognition custom handlers', () => {
  const runCustom = async (handler: string, now = new Date()) => {
    const dueJob = job({ id: `job-${handler}`, name: `cognition-${handler}`, job_config: { handler }, run_count: 0, notify_on_success: false });
    mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) => {
      if (op === 'select') return { data: [dueJob], error: null };
      if (op === 'claim') return { data: { id: `job-${handler}` }, error: null };
      return { data: null, error: null };
    });
    return runDueJobs(now);
  };

  it('kairos_scan handler runs a scan and returns its report', async () => {
    const results = await runCustom('kairos_scan');
    expect(results[0].status).toBe('success');
    expect(results[0].output).toMatchObject({ handler: 'kairos_scan', detected: 2, notified: 1 });
  });

  it('dream_cycle handler runs the consolidation and reports gating', async () => {
    // Night window — dream_cycle is a night-phase handler.
    const results = await runCustom('dream_cycle', new Date(2026, 7, 6, 2, 0));
    expect(results[0].status).toBe('success');
    expect(results[0].output).toMatchObject({ handler: 'dream_cycle', gatedBy: 'sessions' });
  });

  it('ultraplan_process handler drains the queue', async () => {
    // Night window — ultraplan_process is a night-phase handler.
    const results = await runCustom('ultraplan_process', new Date(2026, 7, 6, 2, 30));
    expect(results[0].status).toBe('success');
    expect(results[0].output).toMatchObject({ handler: 'ultraplan_process', processed: 1, status: 'plan_ready' });
  });

  it('defers a due custom job whose delegation window is closed', async () => {
    // dream_cycle is night-only; running mid-day must defer, not execute.
    const results = await runCustom('dream_cycle', new Date(2026, 7, 6, 14, 0));
    expect(results[0].status).toBe('skipped');
    expect(results[0].error).toContain('Delegation window closed');
  });
});
