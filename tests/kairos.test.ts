import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-kairos-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

vi.mock('../src/lib/draymond/monitors', () => ({ checkAllSites: vi.fn() }));
vi.mock('../src/lib/draymond/scheduler', () => ({ listJobs: vi.fn() }));
vi.mock('../src/lib/draymond/business-pipeline', () => ({ listOpportunities: vi.fn() }));
vi.mock('../src/lib/draymond/treasury-state', () => ({ settledRevenueUsd: vi.fn() }));
vi.mock('../src/lib/draymond/mission-strategy', () => ({ readStrategy: vi.fn(), totalMonthlyTarget: vi.fn() }));
vi.mock('../src/lib/draymond/workflow-budget', () => ({ canCallProvider: vi.fn(), providerBudget: vi.fn() }));
vi.mock('../src/lib/draymond/llm', () => ({ buildProviderOrder: vi.fn() }));
vi.mock('../src/lib/draymond/upgrade-queue', () => ({ listUpgradeQueue: vi.fn() }));
vi.mock('../src/lib/draymond/self-repair', () => ({ detectRepairLoops: vi.fn() }));
vi.mock('../src/lib/draymond/heartbeat', () => ({ getHeartbeats: vi.fn() }));
vi.mock('../src/lib/draymond/ntfy', () => ({ publishIssueNotification: vi.fn() }));
vi.mock('../src/lib/draymond/notifications', () => ({ sendAlertEmail: vi.fn() }));
vi.mock('../src/lib/draymond/index', () => ({ logEvent: vi.fn(async () => {}) }));

import type { Mock } from 'vitest';

// Module-level state (interval handle + single-flight flag) forces a fresh
// module instance per test case. Factory-mocked modules keep their real
// types, so the dynamic imports are cast to the mocked shape at runtime.
let kairos: typeof import('../src/lib/draymond/kairos');
let monitors: { checkAllSites: Mock };
let scheduler: { listJobs: Mock };
let pipeline: { listOpportunities: Mock };
let treasury: { settledRevenueUsd: Mock };
let strategy: { readStrategy: Mock; totalMonthlyTarget: Mock };
let budget: { canCallProvider: Mock; providerBudget: Mock };
let llm: { buildProviderOrder: Mock };
let queue: { listUpgradeQueue: Mock };
let repair: { detectRepairLoops: Mock };
let heartbeat: { getHeartbeats: Mock };
let ntfy: { publishIssueNotification: Mock };
let notifications: { sendAlertEmail: Mock };
let index: { logEvent: Mock };

beforeEach(async () => {
  vi.resetModules();
  kairos = await import('../src/lib/draymond/kairos');
  monitors = (await import('../src/lib/draymond/monitors')) as unknown as { checkAllSites: Mock };
  scheduler = (await import('../src/lib/draymond/scheduler')) as unknown as { listJobs: Mock };
  pipeline = (await import('../src/lib/draymond/business-pipeline')) as unknown as { listOpportunities: Mock };
  treasury = (await import('../src/lib/draymond/treasury-state')) as unknown as { settledRevenueUsd: Mock };
  strategy = (await import('../src/lib/draymond/mission-strategy')) as unknown as {
    readStrategy: Mock;
    totalMonthlyTarget: Mock;
  };
  budget = (await import('../src/lib/draymond/workflow-budget')) as unknown as {
    canCallProvider: Mock;
    providerBudget: Mock;
  };
  llm = (await import('../src/lib/draymond/llm')) as unknown as { buildProviderOrder: Mock };
  queue = (await import('../src/lib/draymond/upgrade-queue')) as unknown as { listUpgradeQueue: Mock };
  repair = (await import('../src/lib/draymond/self-repair')) as unknown as { detectRepairLoops: Mock };
  heartbeat = (await import('../src/lib/draymond/heartbeat')) as unknown as { getHeartbeats: Mock };
  ntfy = (await import('../src/lib/draymond/ntfy')) as unknown as { publishIssueNotification: Mock };
  notifications = (await import('../src/lib/draymond/notifications')) as unknown as { sendAlertEmail: Mock };
  index = (await import('../src/lib/draymond/index')) as unknown as { logEvent: Mock };
  delete process.env.KAIROS_DIGEST_EMAIL;
  delete process.env.KAIROS_TICK_BUDGET_MS;
  delete process.env.KAIROS_TICK_MS;
  vi.useRealTimers();
  // Isolated state per test — the scan feed must not leak across cases.
  fs.rmSync(path.join(tmp, 'kairos.json'), { force: true });
  // resetModules does NOT reset the mock registry — clear accumulated call
  // history, then install safe empty defaults so unmocked detectors in a given
  // test produce zero hits instead of throwing (or worse, emitting).
  vi.clearAllMocks();
  monitors.checkAllSites.mockResolvedValue({ ...DOWN_RESULT, results: [] });
  scheduler.listJobs.mockResolvedValue([]);
  pipeline.listOpportunities.mockResolvedValue([]);
  treasury.settledRevenueUsd.mockResolvedValue(0);
  strategy.readStrategy.mockResolvedValue({});
  strategy.totalMonthlyTarget.mockReturnValue(0); // no target → no moment
  budget.canCallProvider.mockReturnValue({ ok: true });
  budget.providerBudget.mockReturnValue(0);
  llm.buildProviderOrder.mockReturnValue([]);
  queue.listUpgradeQueue.mockResolvedValue([]);
  repair.detectRepairLoops.mockResolvedValue([]);
  heartbeat.getHeartbeats.mockResolvedValue({});
  ntfy.publishIssueNotification.mockResolvedValue(undefined);
  notifications.sendAlertEmail.mockResolvedValue(undefined);
});

afterEach(() => {
  kairos.stopKairos();
  vi.useRealTimers();
});

const DOWN_RESULT = {
  checked_at: new Date().toISOString(),
  total: 1,
  up: 0,
  down: 1,
  errors: 0,
  results: [
    {
      monitor_id: 'm1',
      monitor_name: 'uplift.ai',
      url: 'https://uplift.ai',
      status_code: null,
      response_time_ms: null,
      is_up: false,
      previous_status: 'up',
      new_status: 'down',
      consecutive_failures: 3,
    },
  ],
};

describe('kairos detectors', () => {
  it('detectors emit moments for down monitors and failed jobs', async () => {
    monitors.checkAllSites.mockResolvedValue(DOWN_RESULT);
    scheduler.listJobs.mockResolvedValue([
      { id: 'j1', name: 'night-recap', last_run_status: 'failed', last_error: 'boom', fail_count: 2 },
    ]);
    const r = await kairos.kairosScan();
    expect(r.detected).toBe(2);
    const feed = await kairos.kairosFeed();
    expect(feed).toHaveLength(2);
    expect(feed.find((m) => m.kind === 'monitor_down')?.severity).toBe('critical');
    expect(feed.find((m) => m.kind === 'job_failed')?.severity).toBe('warn');
    expect(index.logEvent).toHaveBeenCalled();
    expect(ntfy.publishIssueNotification).toHaveBeenCalled(); // critical moment
  });

  it('a missing detector dependency degrades to a captured error, not a crash', async () => {
    monitors.checkAllSites.mockRejectedValue(new Error('drift: module missing'));
    scheduler.listJobs.mockResolvedValue([]);
    const r = await kairos.kairosScan();
    expect(r.errors[0]).toMatch(/monitor_down/);
    expect(r.detected).toBe(0);
  });

  it('dedupes repeats: occurrences bump, no new moment, no re-notify within 24h', async () => {
    monitors.checkAllSites.mockResolvedValue(DOWN_RESULT);
    await kairos.kairosScan();
    await kairos.kairosScan();
    const feed = await kairos.kairosFeed();
    expect(feed).toHaveLength(1);
    expect(feed[0]!.occurrences).toBe(2);
    // critical stays critical (no escalation) and lastSeen < 24h → no re-notify
    expect(ntfy.publishIssueNotification).toHaveBeenCalledTimes(1);
  });

  it('escalates severity on repeats (warn → critical) and re-notifies on escalation', async () => {
    scheduler.listJobs.mockResolvedValue([
      { id: 'j1', name: 'night-recap', last_run_status: 'failed', last_error: 'boom', fail_count: 2 },
    ]);
    await kairos.kairosScan();
    await kairos.kairosScan();
    const feed = await kairos.kairosFeed();
    expect(feed.find((m) => m.kind === 'job_failed')?.severity).toBe('critical');
    expect(feed.find((m) => m.kind === 'job_failed')?.occurrences).toBe(2);
    // initial warn moments do not notify — only the critical escalation does
    expect(ntfy.publishIssueNotification).toHaveBeenCalledTimes(1);
  });

  it('acks a moment and the feed respects acked/kind/severity/limit filters', async () => {
    monitors.checkAllSites.mockResolvedValue(DOWN_RESULT);
    scheduler.listJobs.mockResolvedValue([
      { id: 'j1', name: 'night-recap', last_run_status: 'failed', last_error: 'boom', fail_count: 2 },
    ]);
    await kairos.kairosScan();
    const [down] = (await kairos.kairosFeed({ kind: 'monitor_down' }));
    await kairos.ackMoment(down!.id);
    expect(await kairos.kairosFeed({ acked: false })).toHaveLength(1);
    expect(await kairos.kairosFeed({ acked: true })).toHaveLength(1);
    expect(await kairos.kairosFeed({ kind: 'job_failed' })).toHaveLength(1);
    expect(await kairos.kairosFeed({ severity: 'critical' })).toHaveLength(1);
    expect(await kairos.kairosFeed({ limit: 1 })).toHaveLength(1);
  });

  it('respects the tick budget and skips remaining detectors when exceeded', async () => {
    process.env.KAIROS_TICK_BUDGET_MS = '1';
    monitors.checkAllSites.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { ...DOWN_RESULT, results: [] };
    });
    vi.useFakeTimers();
    const scanPromise = kairos.kairosScan();
    await vi.advanceTimersByTimeAsync(60);
    const r = await scanPromise;
    expect(r.budgetExceeded).toBe(true);
    expect(r.detected).toBe(0);
    // job_failed detector never ran
    expect(scheduler.listJobs).not.toHaveBeenCalled();
  });

  it('sends a daily digest of un-acked moments when KAIROS_DIGEST_EMAIL is set', async () => {
    process.env.KAIROS_DIGEST_EMAIL = 'ops@uplift.ai';
    scheduler.listJobs.mockResolvedValue([
      { id: 'j1', name: 'night-recap', last_run_status: 'failed', last_error: 'boom', fail_count: 2 },
    ]);
    const r = await kairos.kairosScan();
    expect(r.notified).toBeGreaterThanOrEqual(0);
    expect(notifications.sendAlertEmail).toHaveBeenCalled();
    expect(notifications.sendAlertEmail.mock.calls[0][0]).toBe('ops@uplift.ai');
    // second scan within 24h → no second digest
    notifications.sendAlertEmail.mockClear();
    await kairos.kairosScan();
    expect(notifications.sendAlertEmail).not.toHaveBeenCalled();
  });
});

describe('kairos daemon', () => {
  it('runs a catch-up scan on start, ticks on the interval, and stops cleanly', async () => {
    process.env.KAIROS_TICK_MS = '5000';
    monitors.checkAllSites.mockResolvedValue({ ...DOWN_RESULT, results: [] });
    vi.useFakeTimers();
    kairos.startKairos();
    expect(kairos.isKairosRunning()).toBe(true);
    await vi.advanceTimersByTimeAsync(0); // flush the catch-up scan
    expect(monitors.checkAllSites).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(monitors.checkAllSites).toHaveBeenCalledTimes(2);
    kairos.stopKairos();
    expect(kairos.isKairosRunning()).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(monitors.checkAllSites).toHaveBeenCalledTimes(2); // no further ticks
  });
});

describe('kairos branch coverage', () => {
  it('flags stale leads and skips fresh or non-lead opportunities', async () => {
    pipeline.listOpportunities.mockResolvedValue([
      { id: 'o1', name: 'Old Corp', stage: 'lead', updatedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() },
      { id: 'o2', name: 'Fresh Corp', stage: 'lead', updatedAt: new Date().toISOString() },
      { id: 'o3', name: 'Won Corp', stage: 'won', updatedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() },
    ]);
    await kairos.kairosScan();
    const feed = await kairos.kairosFeed();
    expect(feed.filter((m) => m.kind === 'stale_lead')).toHaveLength(1);
    expect(feed[0]!.title).toContain('Old Corp');
  });

  it('emits a revenue shortfall moment but stays quiet at/above target', async () => {
    strategy.totalMonthlyTarget.mockReturnValue(10_000);
    treasury.settledRevenueUsd.mockResolvedValue(4_000);
    await kairos.kairosScan();
    let feed = await kairos.kairosFeed();
    expect(feed.filter((m) => m.kind === 'revenue_shortfall')).toHaveLength(1);
    // above target → no new moment
    treasury.settledRevenueUsd.mockResolvedValue(12_000);
    await kairos.kairosScan();
    feed = await kairos.kairosFeed();
    expect(feed.filter((m) => m.kind === 'revenue_shortfall')).toHaveLength(1);
  });

  it('emits budget-pressure moments only for exhausted providers', async () => {
    llm.buildProviderOrder.mockReturnValue(['deepseek', 'openai']);
    budget.canCallProvider.mockImplementation((p: string) =>
      p === 'deepseek' ? { ok: false, reason: 'out of budget' } : { ok: true }
    );
    budget.providerBudget.mockReturnValue(100);
    await kairos.kairosScan();
    const feed = await kairos.kairosFeed();
    expect(feed.filter((m) => m.kind === 'budget_pressure')).toHaveLength(1);
    expect(feed[0]!.detail).toContain('out of budget');
  });

  it('flags the weakest agent when above the score floor', async () => {
    queue.listUpgradeQueue.mockResolvedValue([
      { id: 'q1', component_name: 'coder', component_class: 'coder', component_slug: 'coder', weakness_score: 0.9, proposed_action: 'retrain' },
      { id: 'q2', component_name: 'planner', component_class: 'planner', component_slug: 'planner', weakness_score: 0.3 },
    ]);
    await kairos.kairosScan();
    const feed = await kairos.kairosFeed();
    const hits = feed.filter((m) => m.kind === 'weak_agent');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.detail).toContain('coder');
  });

  it('emits repair_loop moments only for escalated loops', async () => {
    repair.detectRepairLoops.mockResolvedValue([
      { signal: 'job x', attempts: 6, window: { from: 'a', to: 'b' }, action: 'escalated' },
      { signal: 'job y', attempts: 2, window: { from: 'a', to: 'b' }, action: 'keep-going' },
    ]);
    await kairos.kairosScan();
    const feed = await kairos.kairosFeed();
    expect(feed.filter((m) => m.kind === 'repair_loop')).toHaveLength(1);
  });

  it('flags stale/down heartbeats and ignores healthy ones', async () => {
    heartbeat.getHeartbeats.mockResolvedValue({
      a1: { slug: 'a1', name: 'A', last_seen: new Date(Date.now() - 2 * 3_600_000).toISOString(), up: true, detail: 'stale' },
      a2: { slug: 'a2', name: 'B', last_seen: new Date().toISOString(), up: false, detail: 'down' },
      a3: { slug: 'a3', name: 'C', last_seen: new Date().toISOString(), up: true, detail: '' },
    });
    await kairos.kairosScan();
    const feed = await kairos.kairosFeed();
    expect(feed.filter((m) => m.kind === 'stale_heartbeat')).toHaveLength(2);
  });

  it('trims the feed to KAIROS_CAP', async () => {
    process.env.KAIROS_CAP = '10'; // cap() clamps anything below 10 up to 10
    for (const id of ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8', 'j9', 'j10', 'j11', 'j12']) {
      scheduler.listJobs.mockResolvedValue([
        { id, name: `job-${id}`, last_run_status: 'failed', last_error: `boom-${id}`, fail_count: 1 },
      ]);
      await kairos.kairosScan();
    }
    expect(await kairos.kairosFeed()).toHaveLength(10);
  });

  it('ackMoment returns false for unknown ids', async () => {
    expect(await kairos.ackMoment('nope')).toBe(false);
  });

  it('re-notifies when lastSeen is older than the repeat window (even without escalation)', async () => {
    process.env.KAIROS_REPEAT_NOTIFY_HOURS = '1';
    monitors.checkAllSites.mockResolvedValue(DOWN_RESULT);
    scheduler.listJobs.mockResolvedValue([
      { id: 'j1', name: 'night-recap', last_run_status: 'failed', last_error: 'boom', fail_count: 2 },
    ]);
    await kairos.kairosScan();
    expect(ntfy.publishIssueNotification).toHaveBeenCalledTimes(1); // monitor_down critical only
    // Age both moments beyond the repeat window and re-scan.
    const file = path.join(tmp, 'kairos.json');
    const state = JSON.parse(fs.readFileSync(file, 'utf-8'));
    for (const m of state.moments) m.lastSeen = new Date(Date.now() - 2 * 3_600_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(state));
    await kairos.kairosScan();
    // job_failed escalates warn→critical (notify), monitor_down re-notifies via the repeat window (notify).
    expect(ntfy.publishIssueNotification).toHaveBeenCalledTimes(3);
  });

  it('startKairos is idempotent and survives a failing scan', async () => {
    process.env.KAIROS_TICK_MS = '5000';
    monitors.checkAllSites.mockResolvedValue({ ...DOWN_RESULT, results: [] });
    vi.useFakeTimers();
    kairos.startKairos();
    kairos.startKairos(); // already running → no second timer
    expect(kairos.isKairosRunning()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(monitors.checkAllSites).toHaveBeenCalledTimes(1); // single catch-up
    monitors.checkAllSites.mockRejectedValue(new Error('boom'));
    await vi.advanceTimersByTimeAsync(5000); // tick with failing scan → error swallowed
    kairos.stopKairos();
    expect(kairos.isKairosRunning()).toBe(false);
  });
});
