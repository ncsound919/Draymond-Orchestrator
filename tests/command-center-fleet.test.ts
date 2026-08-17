import { describe, expect, it } from 'vitest';
import {
  DAY_PHASES,
  agentHealthyCount,
  brainHealth,
  chainStatusBadge,
  jobEnabledCount,
  jobStatusBadge,
  phaseList,
  relativeTime,
  statusColor,
} from '../src/components/command-center/fleet-lib';

describe('fleet-lib — phaseList', () => {
  it('returns the four orchestrated day phases in run order', () => {
    expect(phaseList()).toEqual(['morning', 'midday', 'evening', 'night']);
  });

  it('has exactly 4 phases and does not mutate the shared constant', () => {
    const list = phaseList();
    expect(list).toHaveLength(4);
    list.pop();
    expect(DAY_PHASES).toHaveLength(4);
  });
});

describe('fleet-lib — jobEnabledCount', () => {
  it('counts only enabled jobs', () => {
    const jobs = [
      { id: 'a', is_enabled: true },
      { id: 'b', is_enabled: false },
      { id: 'c', is_enabled: true },
    ];
    expect(jobEnabledCount(jobs)).toBe(2);
  });

  it('treats a missing is_enabled flag as not enabled', () => {
    const jobs: Array<{ id: string; is_enabled?: boolean }> = [
      { id: 'a' },
      { id: 'b', is_enabled: true },
    ];
    expect(jobEnabledCount(jobs)).toBe(1);
  });

  it('handles null / undefined / empty lists defensively', () => {
    expect(jobEnabledCount(null)).toBe(0);
    expect(jobEnabledCount(undefined)).toBe(0);
    expect(jobEnabledCount([])).toBe(0);
  });
});

describe('fleet-lib — agentHealthyCount', () => {
  it('counts only active agents', () => {
    const agents = [
      { id: '1', status: 'active' },
      { id: '2', status: 'degraded' },
      { id: '3', status: 'active' },
      { id: '4', status: 'crashed' },
    ];
    expect(agentHealthyCount(agents)).toBe(2);
  });

  it('handles missing status and empty/null lists defensively', () => {
    const agents: Array<{ id: string; status?: string }> = [
      { id: 'a' },
      { id: 'b', status: 'active' },
    ];
    expect(agentHealthyCount(agents)).toBe(1);
    expect(agentHealthyCount(null)).toBe(0);
    expect(agentHealthyCount(undefined)).toBe(0);
    expect(agentHealthyCount([])).toBe(0);
  });
});

describe('fleet-lib — relativeTime', () => {
  it('returns Never for null / undefined / empty', () => {
    expect(relativeTime(null)).toBe('Never');
    expect(relativeTime(undefined)).toBe('Never');
    expect(relativeTime('')).toBe('Never');
  });

  it('returns Never for an unparseable timestamp', () => {
    expect(relativeTime('not-a-date')).toBe('Never');
  });

  it('returns just now for a future timestamp', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(relativeTime(future)).toBe('just now');
  });

  it('formats recent seconds', () => {
    const iso = new Date(Date.now() - 5_000).toISOString();
    expect(relativeTime(iso)).toBe('5s ago');
  });

  it('formats recent minutes', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(iso)).toBe('5m ago');
  });

  it('formats hours and days', () => {
    expect(relativeTime(new Date(Date.now() - 3 * 60 * 60_000).toISOString())).toBe('3h ago');
    expect(relativeTime(new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString())).toBe('2d ago');
  });
});

describe('fleet-lib — statusColor', () => {
  it('maps known agent statuses to tailwind dot colors', () => {
    expect(statusColor('active')).toBe('bg-green-500');
    expect(statusColor('degraded')).toBe('bg-yellow-500');
    expect(statusColor('stalled')).toBe('bg-orange-500');
    expect(statusColor('crashed')).toBe('bg-red-500');
    expect(statusColor('recovering')).toBe('bg-blue-500');
    expect(statusColor('suspended')).toBe('bg-gray-500');
  });

  it('falls back to gray for unknown or missing statuses', () => {
    expect(statusColor('mystery-status')).toBe('bg-gray-500');
    expect(statusColor(null)).toBe('bg-gray-500');
    expect(statusColor(undefined)).toBe('bg-gray-500');
  });
});

describe('fleet-lib — brainHealth', () => {
  it('reports offline for a null / missing payload', () => {
    expect(brainHealth(null)).toBe('offline');
    expect(brainHealth(undefined)).toBe('offline');
  });

  it('reports degraded when there is no recorded run', () => {
    expect(brainHealth({ last_run_at: null })).toBe('degraded');
    expect(brainHealth({})).toBe('degraded');
  });

  it('reports online for a recent run', () => {
    const recent = new Date(Date.now() - 30 * 60_000).toISOString();
    expect(brainHealth({ last_run_at: recent })).toBe('online');
  });

  it('reports degraded for a stale run (> 24h)', () => {
    const stale = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
    expect(brainHealth({ last_run_at: stale })).toBe('degraded');
  });
});

describe('fleet-lib — status badges', () => {
  it('maps chain statuses to pill classes with a gray fallback', () => {
    expect(chainStatusBadge('running')).toBe('bg-blue-500/20 text-blue-400');
    expect(chainStatusBadge('completed')).toBe('bg-green-500/20 text-green-400');
    expect(chainStatusBadge('failed')).toBe('bg-red-500/20 text-red-400');
    expect(chainStatusBadge('nope')).toBe('bg-gray-500/20 text-gray-400');
    expect(chainStatusBadge(null)).toBe('bg-gray-500/20 text-gray-400');
  });

  it('maps job run statuses to pill classes with a gray fallback', () => {
    expect(jobStatusBadge('success')).toBe('bg-green-500/20 text-green-400');
    expect(jobStatusBadge('failed')).toBe('bg-red-500/20 text-red-400');
    expect(jobStatusBadge('running')).toBe('bg-blue-500/20 text-blue-400');
    expect(jobStatusBadge('mystery')).toBe('bg-gray-500/20 text-gray-400');
  });
});
