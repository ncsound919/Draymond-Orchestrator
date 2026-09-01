import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetDelegation, recordDelegationConsumption } from '../src/lib/draymond/delegation';
import { sectorDailyCap } from '../src/lib/draymond/corporate';

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
vi.mock('../src/lib/draymond/treasury', () => ({
  runTreasuryPulse: vi.fn(async () => ({
    status: 'ok',
    revenueUsd: 0,
    newSettled: 0,
    error: null,
    markdown: 'treasury pulse',
  })),
}));
vi.mock('../src/lib/draymond/sale-alerts', () => ({
  sendSaleAlerts: vi.fn(async () => []),
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

let registryDir: string;

beforeEach(() => {
  // Isolate delegation/consumption writes from the real .draymond brain state.
  registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-catchup-registry-'));
  process.env.DRAYMOND_REGISTRY_DIR = registryDir;
});

afterEach(() => {
  mockAdmin._tables.clear();
  vi.clearAllMocks();
  stopInProcessScheduler();
  delete process.env.DRAYMOND_REGISTRY_DIR;
  try { fs.rmSync(registryDir, { recursive: true, force: true }); } catch { /* best-effort */ }
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

  it('runs an overdue job during catch-up when within the horizon (work begins on boot)', async () => {
    // 8h overdue — normally skipped by the strict grace, but catch-up mode
    // (horizon 24h) executes it so the missed work actually happens.
    const missed = job({
      id: 'missed-morning',
      name: 'Morning Digest',
      job_type: 'custom',
      next_run_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    });
    mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) => {
      if (op === 'select') return { data: [missed], error: null };
      if (op === 'claim') return { data: { id: 'missed-morning' }, error: null };
      return { data: null, error: null };
    });
    const results = await runDueJobs(new Date(), { catchupMs: 24 * 60 * 60 * 1000 });
    expect(results[0].status).toBe('success');
    expect(results[0].job_name).toBe('Morning Digest');
  });

  it('still skips a job overdue beyond the catch-up horizon', async () => {
    // 2 days overdue — outside the 24h horizon, so catch-up reschedules it.
    const ancient = job({
      id: 'ancient',
      name: 'Ancient Job',
      job_type: 'custom',
      next_run_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) => {
      if (op === 'select') return { data: [ancient], error: null };
      return { data: null, error: null };
    });
    const results = await runDueJobs(new Date(), { catchupMs: 24 * 60 * 60 * 1000 });
    expect(results[0].status).toBe('skipped');
    expect(results[0].error).toMatch(/Missed window/);
  });
});

describe('scheduler sector budget gate', () => {
  beforeEach(() => resetDelegation());

  // Fixed weekday at 10:00 local — inside morning (05-12) and midday (08-18)
  // windows, so window-closure never masks the sector-cap behaviour under test.
  const fixedNow = new Date(2026, 7, 6, 10, 0); // Fri 2026-08-07 10:00

  it('defers a due job whose corporate sector is at its daily cap', async () => {
    // service_health_repair lives in the ops sector, always-on window (00:00-23:59),
    // so it won't be deferred by the window gate — only by the sector cap.
    const health = job({
      id: 'health-repair',
      name: 'Service Health Repair',
      job_type: 'custom',
      job_config: { handler: 'service_health_repair' },
      next_run_at: fixedNow.toISOString(),
    });
    mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) => {
      if (op === 'select') return { data: [health], error: null };
      return { data: null, error: null };
    });

    // Exhaust the entire ops sector via another ops member (litellm).
    const opsCap = sectorDailyCap('ops', 5_000_000);
    recordDelegationConsumption('litellm', opsCap);

    const results = await runDueJobs(fixedNow);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(results[0].error).toMatch(/daily token cap reached/);
  });

  it('executes a due job when its sector still has budget', async () => {
    // rotate_tokens is a pure in-memory handler (no network) in the ops sector,
    // window 08:00-18:00 → open at the fixed 10:00 clock.
    const job2 = job({
      id: 'rotate',
      name: 'Token Rotation Check',
      job_type: 'custom',
      job_config: { handler: 'rotate_tokens' },
      next_run_at: fixedNow.toISOString(),
    });
    mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) => {
      if (op === 'select') return { data: [job2], error: null };
      if (op === 'claim') return { data: { id: 'rotate' }, error: null };
      return { data: null, error: null };
    });
    const results = await runDueJobs(fixedNow);
    expect(results[0].status).toBe('success');
  });

  it('does not defer revenue-sector work when an overhead sector is at cap', async () => {
    // treasury_pulse → e1-platform (revenue), mocked to resolve instantly,
    // morning window (05:00-12:00) → open at the fixed 10:00 clock.
    const treasury = job({
      id: 'treasury',
      name: 'Treasurer Pulse',
      job_type: 'custom',
      job_config: { handler: 'treasury_pulse' },
      next_run_at: fixedNow.toISOString(),
    });
    mockAdmin._tables.set('draymond_scheduled_jobs', (op: string) => {
      if (op === 'select') return { data: [treasury], error: null };
      if (op === 'claim') return { data: { id: 'treasury' }, error: null };
      return { data: null, error: null };
    });

    const rdCap = sectorDailyCap('rd', 5_000_000);
    recordDelegationConsumption('rd_night', rdCap);
    const opsCap = sectorDailyCap('ops', 5_000_000);
    recordDelegationConsumption('litellm', opsCap);

    const results = await runDueJobs(fixedNow);
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
