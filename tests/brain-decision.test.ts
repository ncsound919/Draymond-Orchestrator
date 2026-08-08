import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/draymond/brain-client', () => ({
  getBrainStatus: vi.fn(async () => null),
  runBrainSweep: vi.fn(async () => null),
  isBrainConfigured: vi.fn(() => false),
}));

// Block network: brain /reason goes nowhere in tests.
vi.mock('../src/lib/draymond/system-intel', () => ({
  getSystemIntel: vi.fn(async () => ({
    generated_at: new Date().toISOString(),
    agents: [], entities: { total: 0, active: 0, by_kind: {}, unhealthy: [] },
    chains: { total: 0, by_status: {}, recent: [] },
    jobs: { total: 0, enabled: 0, failed_recently: [], next_up: [] },
    monitors: { total: 0, down: [] },
    notifications: { recent: [], failed_recently: 0 },
    actions: { by_status: {}, pending: [] },
    goals: { active: [] },
    memory: { total: 0, by_tier: {} },
    events: { last_24h: 0, recent: [] },
    handoffs_last_24h: 0,
    benchmarks: { latest: [] },
    upgrade_queue: { items: [] },
    execution: { recent: [], failed_recently: 0 },
    repairs: { recent: [] },
    knowledge_graph: { indexed: false, report_excerpt: null },
    brain: null,
  })),
}));

vi.mock('../src/lib/draymond/self-learning', () => ({
  getLessons: vi.fn(async () => []),
  recordOutcome: vi.fn(async () => ({ id: 'x', createdAt: new Date().toISOString() })),
}));

vi.mock('../src/lib/draymond/workflow-budget', () => ({
  isOnCooldown: vi.fn(() => false),
}));

vi.mock('../src/lib/draymond/scheduler', async () => {
  const actual = await vi.importActual('../src/lib/draymond/scheduler');
  return {
    ...(actual as object),
    listJobs: vi.fn(async () => []),
    updateJob: vi.fn(async () => ({})),
  };
});

import { runBrainDecision } from '../src/lib/draymond/brain-decision';

afterEach(() => {
  vi.clearAllMocks();
});

describe('brain decision engine', () => {
  it('focuses on the lowest-progress agenda goal', async () => {
    const d = await runBrainDecision({
      agenda: [{ title: 'Weekly growth strategy', progress: 90 }, { title: 'System integrity & uptime', progress: 10 }],
      failingJobs: [],
      downMonitors: [],
      brainReachable: false,
    });
    expect(d.focusGoal).toBe('System integrity & uptime');
    expect(d.brainConsulted).toBe(false);
  });

  it('routes failing jobs and down monitors to the repair queue', async () => {
    const d = await runBrainDecision({
      agenda: [{ title: 'A', progress: 50 }],
      failingJobs: [{ name: 'Daily Book Library Scan', error: 'fetch failed' }],
      downMonitors: ['Uplift Agent'],
      brainReachable: false,
    });
    const signals = d.repairQueue.map((r) => r.signal);
    expect(signals).toContain('job:error');
    expect(signals).toContain('monitor:down');
  });
});
