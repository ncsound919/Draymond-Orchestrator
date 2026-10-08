import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  BUSINESS,
  CONTINUOUS,
  GATED_OFF,
  JOB_SCHEDULE,
  MORNING,
  NIGHT,
  STRATEGY,
  applySchedulePolicy,
  diffSchedulePolicy,
  type PolicyInputJob,
} from '../src/lib/draymond/schedule-policy';
import { type ScheduledJob } from '../src/lib/draymond/scheduler';

vi.mock('../src/lib/draymond/scheduler', () => ({
  listJobs: vi.fn(),
  updateJob: vi.fn(async (id: string, updates: Record<string, unknown>) => ({ id, ...updates })),
}));

const schedulerMock = await import('../src/lib/draymond/scheduler');
const listJobs = vi.mocked(schedulerMock.listJobs);
const updateJob = vi.mocked(schedulerMock.updateJob);

const SECTIONS = { CONTINUOUS, NIGHT, MORNING, BUSINESS, STRATEGY, GATED_OFF };

describe('schedule policy table', () => {
  it('has no duplicate job names across sections (no silent override)', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const [section, rules] of Object.entries(SECTIONS)) {
      for (const name of Object.keys(rules)) {
        if (seen.has(name)) dupes.push(`${name} (${seen.get(name)} + ${section})`);
        else seen.set(name, section);
      }
    }
    expect(dupes).toEqual([]);
    expect(Object.keys(JOB_SCHEDULE).length).toBe(seen.size);
  });

  it('every rule has a non-empty rationale and a 5-field cron', () => {
    for (const [name, rule] of Object.entries(JOB_SCHEDULE)) {
      expect(rule.rationale.length, `${name} rationale`).toBeGreaterThan(4);
      expect(rule.cron.trim().split(/\s+/).length, `${name} cron`).toBe(5);
    }
  });

  it('holds degraded-tier product lines OFF and keeps core ops ON', () => {
    expect(JOB_SCHEDULE['Music Shift'].enabled).toBe(false);
    expect(JOB_SCHEDULE['Daily Marketing Run'].enabled).toBe(false);
    expect(JOB_SCHEDULE['Book-Grounded Research'].enabled).toBe(false);
    expect(JOB_SCHEDULE['Agent Health Check'].enabled).toBe(true);
    expect(JOB_SCHEDULE['Daily Repair Shift'].enabled).toBe(true);
    expect(JOB_SCHEDULE['Weekly Strategy Review'].enabled).toBe(true);
  });
});

describe('diffSchedulePolicy', () => {
  const job = (name: string, cron: string, enabled: boolean): PolicyInputJob => ({
    id: name,
    name,
    cron_expression: cron,
    is_enabled: enabled,
  });

  it('returns no changes when jobs already match the policy', () => {
    const rule = JOB_SCHEDULE['Agent Health Check'];
    const { changes, unknown } = diffSchedulePolicy([job('Agent Health Check', rule.cron, rule.enabled)]);
    expect(changes).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it('flags an enablement change', () => {
    const rule = JOB_SCHEDULE['Music Shift'];
    const { changes } = diffSchedulePolicy([job('Music Shift', rule.cron, true)]);
    expect(changes).toHaveLength(1);
    expect(changes[0].to.enabled).toBe(false);
  });

  it('flags a cadence change', () => {
    const rule = JOB_SCHEDULE['Kairos Scan'];
    const { changes } = diffSchedulePolicy([job('Kairos Scan', '0 0 * * *', rule.enabled)]);
    expect(changes).toHaveLength(1);
    expect(changes[0].to.cron).toBe(rule.cron);
  });

  it('reports enabled jobs with no rule as drift (unknown), ignores disabled ones', () => {
    const { unknown } = diffSchedulePolicy([
      job('A Brand New Job', '0 0 * * *', true),
      job('An Old Disabled Job', '0 0 * * *', false),
    ]);
    expect(unknown).toEqual(['A Brand New Job']);
  });
});

describe('applySchedulePolicy next_run_at heal', () => {
  const mkJob = (
    name: string,
    over: { enabled?: boolean; cron?: string; next?: string | null } = {},
  ): ScheduledJob => ({
    id: `id-${name}`,
    name,
    description: null,
    cron_expression: over.cron ?? '0 5 * * *',
    job_type: 'custom',
    job_config: {},
    is_enabled: over.enabled ?? true,
    last_run_at: null,
    next_run_at: over.next === undefined ? '2026-09-29T05:00:00.000Z' : over.next,
    last_run_status: 'never',
    last_run_duration_ms: null,
    last_error: null,
    run_count: 0,
    fail_count: 0,
    max_retries: 1,
    timeout_seconds: 300,
    notify_on_failure: false,
    notify_on_success: false,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recomputes next_run_at for an enabled job whose next_run_at is NULL', async () => {
    listJobs.mockResolvedValue([mkJob('Pool Health Check', { cron: '5 5 * * *', next: null })]);

    const out = await applySchedulePolicy();

    expect(out.healed).toEqual(['Pool Health Check']);
    expect(out.updated).toEqual([]);
    expect(updateJob).toHaveBeenCalledTimes(1);
    expect(updateJob).toHaveBeenCalledWith('id-Pool Health Check', { cron_expression: '5 5 * * *' });
  });

  it('does not touch disabled jobs or jobs that already have a next_run_at', async () => {
    listJobs.mockResolvedValue([
      mkJob('Some Disabled Job', { enabled: false, next: null }),
      mkJob('A Healthy Job', { next: '2026-09-29T05:00:00.000Z' }),
    ]);

    const out = await applySchedulePolicy();

    expect(out.healed).toEqual([]);
    expect(updateJob).not.toHaveBeenCalled();
  });

  it('does not double-write when the retune itself already recomputes next_run_at', async () => {
    listJobs.mockResolvedValue([mkJob('Music Shift', { enabled: true, next: null })]);

    const out = await applySchedulePolicy();

    expect(out.updated).toEqual(['Music Shift']);
    expect(out.healed).toEqual([]);
    expect(updateJob).toHaveBeenCalledTimes(1);
  });
});
