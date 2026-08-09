import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-dream-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

// Client mock (gte-capable, count-aware) — follows tests/scheduler.test.ts.
const { mockAdmin } = vi.hoisted(() => {
  const tables = new Map<string, unknown>();
  const makeChain = (table: string) => {
    const op = { current: 'select' as string };
    const resolve = () => {
      const entry = tables.get(table);
      if (typeof entry === 'function') return (entry as (o: string) => unknown)(op.current);
      if (Array.isArray(entry)) return { data: entry, error: null };
      return entry ?? { data: null, error: null };
    };
    const chain = {
      select: vi.fn(() => { op.current = 'select'; return chain; }),
      eq: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      insert: vi.fn(() => { op.current = 'insert'; return chain; }),
      update: vi.fn(() => { op.current = 'update'; return chain; }),
      delete: vi.fn(() => { op.current = 'delete'; return chain; }),
      single: vi.fn(() => Promise.resolve(resolve())),
      maybeSingle: vi.fn(() => Promise.resolve(resolve())),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return chain;
  };
  const admin = { from: vi.fn((t: string) => makeChain(t)), _tables: tables };
  return { mockAdmin: admin };
});

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondClient: vi.fn(async () => mockAdmin),
  createDraymondAdminClient: vi.fn(() => mockAdmin),
}));
vi.mock('../src/lib/draymond/index', () => ({
  storeMemory: vi.fn(async () => {}),
  boostMemory: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
}));
vi.mock('../src/lib/draymond/memory-intelligence', () => ({ runDecaySweep: vi.fn() }));
vi.mock('../src/lib/draymond/self-learning', () => ({ getLessons: vi.fn() }));
vi.mock('../src/lib/draymond/cognition', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/draymond/cognition')>();
  return { ...mod, isSystemIdle: vi.fn(async () => true) };
});

import {
  runDreamCycle,
  dreamReport,
} from '../src/lib/draymond/dream-cycle';
import { storeMemory, logEvent } from '../src/lib/draymond/index';
import { runDecaySweep } from '../src/lib/draymond/memory-intelligence';
import { getLessons } from '../src/lib/draymond/self-learning';

const mockStoreMemory = vi.mocked(storeMemory);
const mockLogEvent = vi.mocked(logEvent);
const mockRunDecaySweep = vi.mocked(runDecaySweep);
const mockGetLessons = vi.mocked(getLessons);

function setTable(table: string, data: unknown, error: unknown = null, count?: number) {
  mockAdmin._tables.set(table, { data, error, count });
}

function memory(overrides: Record<string, unknown> = {}) {
  const base = {
    id: 'mem-1',
    agent_id: 'draymond',
    user_id: 'system',
    key: 'k:1',
    value: { v: 1 },
    summary: 'summary',
    tier: 'contextual',
    importance_score: 0.5,
    decay_rate: 0.1,
    last_accessed_at: new Date().toISOString(),
    access_count: 1,
    source_session_id: null,
    source_event: null,
    is_active: true,
    expired_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  // afterEach tears the tmp dir down — restore the registry dir + a clean
  // state file so every test starts from the plan's default state.
  process.env.DRAYMOND_REGISTRY_DIR = tmp;
  fs.mkdirSync(tmp, { recursive: true });
  fs.rmSync(path.join(tmp, 'dream-cycle.json'), { force: true });
  mockAdmin._tables.clear();
  mockStoreMemory.mockClear();
  mockLogEvent.mockClear();
  mockRunDecaySweep.mockClear();
  mockGetLessons.mockClear();
  delete process.env.DREAM_MIN_HOURS;
  delete process.env.DREAM_MIN_SESSIONS;
  delete process.env.DREAM_STALE_DAYS;
  mockRunDecaySweep.mockResolvedValue({
    total_scanned: 3, decayed: 3, expired: 2, boosted: 0, sweep_duration_ms: 10, swept_at: new Date().toISOString(),
  });
  mockGetLessons.mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('AutoDream gating', () => {
  it('gates on a held lock', async () => {
    const state = { lastDreamAt: null, sessionsCounted: 0, lock: { locked: true, lockedAt: new Date().toISOString() }, reports: [] };
    fs.writeFileSync(path.join(tmp, 'dream-cycle.json'), JSON.stringify(state));
    const report = await runDreamCycle();
    expect(report.gatedBy).toBe('lock');
  });

  it('steals a stale lock (older than 1h)', async () => {
    const state = { lastDreamAt: null, sessionsCounted: 0, lock: { locked: true, lockedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }, reports: [] };
    fs.writeFileSync(path.join(tmp, 'dream-cycle.json'), JSON.stringify(state));
    setTable('draymond_actions', null, null, 7);
    setTable('draymond_scheduled_jobs', null, null, 0);
    setTable('draymond_chains', null, null, 0);
    const report = await runDreamCycle();
    expect(report.gatedBy).toBeUndefined();
    expect(report.sessionsCounted).toBe(7);
  });

  it('gates on the 24h time window', async () => {
    const state = { lastDreamAt: new Date(Date.now() - 3_600_000).toISOString(), sessionsCounted: 10, lock: { locked: false, lockedAt: null }, reports: [] };
    fs.writeFileSync(path.join(tmp, 'dream-cycle.json'), JSON.stringify(state));
    const report = await runDreamCycle();
    expect(report.gatedBy).toBe('time');
  });

  it('gates on the session count', async () => {
    const state = { lastDreamAt: null, sessionsCounted: 0, lock: { locked: false, lockedAt: null }, reports: [] };
    fs.writeFileSync(path.join(tmp, 'dream-cycle.json'), JSON.stringify(state));
    setTable('draymond_actions', null, null, 3);
    setTable('draymond_scheduled_jobs', null, null, 0);
    setTable('draymond_chains', null, null, 0);
    const report = await runDreamCycle();
    expect(report.gatedBy).toBe('sessions');
  });

  it('gates on the idle check (last gate)', async () => {
    const { isSystemIdle } = await import('../src/lib/draymond/cognition');
    vi.mocked(isSystemIdle).mockResolvedValueOnce(false);
    fs.writeFileSync(path.join(tmp, 'dream-cycle.json'), JSON.stringify({
      lastDreamAt: null, sessionsCounted: 0, lock: { locked: false, lockedAt: null }, reports: [],
    }));
    setTable('draymond_actions', null, null, 9);
    setTable('draymond_scheduled_jobs', null, null, 0);
    setTable('draymond_chains', null, null, 0);
    const report = await runDreamCycle();
    expect(report.gatedBy).toBe('idle');
  });

  it('never rejects: a failing session count degrades to a gated error report', async () => {
    fs.writeFileSync(path.join(tmp, 'dream-cycle.json'), JSON.stringify({
      lastDreamAt: null, sessionsCounted: 0, lock: { locked: false, lockedAt: null }, reports: [],
    }));
    setTable('draymond_actions', null, { message: 'db down' });
    const report = await runDreamCycle();
    expect(report.gatedBy).toBe('error');
  });
});

describe('AutoDream phases', () => {
  it('orients, gathers, consolidates, and prunes on a full run', async () => {
    const stale = new Date(Date.now() - 40 * 86_400_000).toISOString();
    setTable('draymond_actions', null, null, 7);
    setTable('draymond_scheduled_jobs', null, null, 0);
    setTable('draymond_chains', null, null, 0);
    setTable('draymond_events', [
      { id: 'e1', event_type: 'chain.completed', message: 'k:dup done', created_at: new Date().toISOString() },
    ]);
    setTable('draymond_memory', [
      memory({ id: 'm1', key: 'k:dup', summary: 'older', importance_score: 0.4, last_accessed_at: stale, created_at: new Date(Date.now() - 86_400_000).toISOString() }),
      memory({ id: 'm2', key: 'k:dup', summary: 'newer', importance_score: 0.9, tier: 'important', last_accessed_at: new Date().toISOString(), created_at: new Date().toISOString() }),
      memory({ id: 'm3', key: 'k:low', summary: 'low value', importance_score: 0.1, last_accessed_at: stale }),
    ]);

    const report = await runDreamCycle();

    expect(report.gatedBy).toBeUndefined();
    expect(report.sessionsCounted).toBe(7);
    expect(report.phases.oriented.total).toBe(3);
    expect(report.phases.oriented.duplicates).toBe(1);
    expect(report.phases.gathered.events).toBe(1);
    expect(report.phases.gathered.duplicateKeys).toBe(1);
    expect(report.phases.consolidated.mergedKeys).toBe(1);
    // promote: m2 (importance 0.9 ≥ 0.75, tier important → bumped via storeMemory)
    expect(report.phases.consolidated.promoted).toBe(1);
    expect(report.phases.pruned.decayed).toBe(3);
    expect(report.phases.pruned.indexEntries).toBe(3);
    expect(report.entries.length).toBeGreaterThanOrEqual(4);

    // storeMemory was used for the merge (upsert kills duplicates), the
    // dream-index rewrite, and the dream_completed row.
    const keys = mockStoreMemory.mock.calls.map((c) => c[0].key);
    expect(keys).toContain('k:dup');
    expect(keys).toContain('dream-index');
    expect(keys).toContain('dream:completed:last');
    // merge carried the max importance + union value
    const mergeCall = mockStoreMemory.mock.calls.find((c) => c[0].key === 'k:dup')![0];
    expect(mergeCall.importance_score).toBe(0.9);
    expect(mergeCall.source_event).toBe('dream_merge');

    expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'dream_completed' }));

    // lock released + state persisted
    const state = JSON.parse(fs.readFileSync(path.join(tmp, 'dream-cycle.json'), 'utf-8'));
    expect(state.lock.locked).toBe(false);
    expect(state.lastDreamAt).toBeTruthy();
    expect(state.reports[0].lastDreamAt).toBe(state.lastDreamAt);
  });

  it('persists distilled lessons as memories and stores them on the report', async () => {
    setTable('draymond_actions', null, null, 7);
    setTable('draymond_scheduled_jobs', null, null, 0);
    setTable('draymond_chains', null, null, 0);
    setTable('draymond_events', []);
    setTable('draymond_memory', []);
    mockGetLessons.mockResolvedValue([
      { id: 'l1', agentId: 'draymond', pattern: 'x y', lesson: 'lesson one', evidenceCount: 3, lastSeen: new Date().toISOString() },
    ]);
    const report = await runDreamCycle();
    expect(report.phases.consolidated.lessonsStored).toBe(1);
    expect(mockStoreMemory.mock.calls.some((c) => c[0].key === 'dream:lesson:l1')).toBe(true);
  });

  it('dreamReport returns the latest report + state', async () => {
    setTable('draymond_actions', null, null, 7);
    setTable('draymond_scheduled_jobs', null, null, 0);
    setTable('draymond_chains', null, null, 0);
    setTable('draymond_events', []);
    setTable('draymond_memory', []);
    await runDreamCycle();
    const report = await dreamReport();
    expect(report.latest).not.toBeNull();
    expect(report.latest!.phases).toBeDefined();
    expect(report.state.lastDreamAt).toBeTruthy();
  });
});

describe('AutoDream branch coverage', () => {
  function baseTables() {
    setTable('draymond_actions', null, null, 7);
    setTable('draymond_scheduled_jobs', null, null, 0);
    setTable('draymond_chains', null, null, 0);
    setTable('draymond_events', []);
  }

  it('gathers outcomes from the learning-outcomes file since the last dream', async () => {
    baseTables();
    // A prior dream yesterday → only newer outcomes are gathered.
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'dream-cycle.json'),
      JSON.stringify({
        lastDreamAt: new Date(Date.now() - 86_400_000).toISOString(),
        sessionsCounted: 0,
        lock: { locked: false, lockedAt: null },
        reports: [],
        updatedAt: new Date().toISOString(),
      })
    );
    fs.writeFileSync(
      path.join(tmp, 'learning-outcomes.json'),
      JSON.stringify([
        { id: 'o1', createdAt: new Date().toISOString() },
        { id: 'o2', createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString() },
        'not-an-object',
      ])
    );
    setTable('draymond_memory', []);
    const report = await runDreamCycle();
    expect(report.phases.gathered.outcomes).toBe(1);
  });

  it('degrades when the memory read fails (orient error entry, rest continues)', async () => {
    baseTables();
    setTable('draymond_memory', null, { message: 'boom' });
    const report = await runDreamCycle();
    expect(report.gatedBy).toBeUndefined();
    expect(report.entries.some((e) => e.includes('oriented failed'))).toBe(true);
  });

  it('degrades the events read to zero events when the query rejects', async () => {
    baseTables();
    mockAdmin._tables.set('draymond_events', () => {
      throw new Error('db down');
    });
    setTable('draymond_memory', []);
    const report = await runDreamCycle();
    expect(report.phases.gathered.events).toBe(0);
    expect(report.gatedBy).toBeUndefined();
  });

  it('corrects contradicted summaries from the latest event', async () => {
    baseTables();
    const stale = new Date(Date.now() - 40 * 86_400_000).toISOString();
    setTable('draymond_events', [
      { id: 'e1', event_type: 'chain.completed', message: 'k:c conflict resolved', created_at: new Date().toISOString() },
    ]);
    setTable('draymond_memory', [
      memory({ id: 'm1', key: 'k:c', summary: 'version A', importance_score: 0.5, last_accessed_at: new Date().toISOString() }),
      memory({ id: 'm2', key: 'k:c', summary: 'version B', importance_score: 0.6, last_accessed_at: stale }),
    ]);
    const report = await runDreamCycle();
    expect(report.phases.consolidated.correctedKeys).toBe(1);
    const corr = mockStoreMemory.mock.calls.find((c) => c[0].source_event === 'dream_correct')![0];
    expect(corr.summary).toContain('corrected');
  });

  it('degrades when the decay sweep fails (prune falls back to zeros)', async () => {
    mockRunDecaySweep.mockRejectedValueOnce(new Error('sweep boom'));
    baseTables();
    setTable('draymond_memory', []);
    const report = await runDreamCycle();
    expect(report.phases.pruned.decayed).toBe(0);
    expect(report.gatedBy).toBeUndefined();
  });

  it('idle gate fails open when the idle check errors', async () => {
    const { isSystemIdle } = await import('../src/lib/draymond/cognition');
    vi.mocked(isSystemIdle).mockRejectedValueOnce(new Error('idle check boom'));
    baseTables();
    setTable('draymond_memory', []);
    const report = await runDreamCycle();
    expect(report.gatedBy).toBeUndefined();
    expect(report.entries.length).toBeGreaterThan(0);
  });
});
