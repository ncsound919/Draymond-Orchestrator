import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockAgents, mockHasAvatar, mockDeepScore, mockRecordRun, mockRecordDeepScores, mockQueueWeakest } =
  vi.hoisted(() => ({
    mockAgents: vi.fn(),
    mockHasAvatar: vi.fn(),
    mockDeepScore: vi.fn(),
    mockRecordRun: vi.fn(),
    mockRecordDeepScores: vi.fn(),
    mockQueueWeakest: vi.fn(),
  }));

vi.mock('@/lib/registry/agent-store', () => ({
  getAllAgents: mockAgents,
  hasRealAvatar: mockHasAvatar,
}));

vi.mock('../src/lib/draymond/deep-scorers', () => ({
  deepScore: mockDeepScore,
}));

vi.mock('../src/lib/draymond/benchmarking', () => ({
  recordRun: mockRecordRun,
  recordDeepScores: mockRecordDeepScores,
}));

vi.mock('../src/lib/draymond/upgrade-queue', () => ({
  queueWeakest: mockQueueWeakest,
}));

import { benchmarkRoster } from '../src/lib/draymond/roster-benchmark';

const agents = [
  { slug: 'grader', name: 'Grader', sourceUrl: 'https://github.com/tap919/Grader' },
  { slug: 'sports-steve', name: 'Sports Steve', sourceUrl: null },
  { slug: 'mutly', name: 'Mutly', sourceUrl: null },
  { slug: 'no-repo', name: 'No Repo', sourceUrl: null },
];

beforeEach(() => {
  vi.resetAllMocks();
  mockAgents.mockResolvedValue(agents);
  mockHasAvatar.mockImplementation((a: { slug: string }) => a.slug !== 'no-repo');
  mockRecordRun.mockResolvedValue({ run_id: 'roster-test', recorded: 2 });
  mockRecordDeepScores.mockResolvedValue(2);
  mockQueueWeakest.mockResolvedValue({ queued: 1, skipped: 1 });
});

describe('benchmarkRoster', () => {
  it('scores only pictured agents with a resolvable repo', async () => {
    mockDeepScore.mockImplementation(async (_cls: string, slug: string) => ({
      reporank: { scorer: 'reporank', score: slug === 'grader' ? 80 : null, summary: 'ok' },
      grader: { scorer: 'grader', score: slug === 'grader' ? 70 : null, summary: 'ok' },
    }));

    const result = await benchmarkRoster({ queueLimit: 5 });

    // grader (real pic + repo), mutly (real pic + repo map), sports-steve (real pic + repo map)
    expect(result.measured).toBe(3);
    // no-repo has an avatar but no repo → excluded
    expect(mockDeepScore).not.toHaveBeenCalledWith('entity', 'no-repo', expect.anything(), expect.anything());
    expect(mockRecordRun).toHaveBeenCalledOnce();
    expect(mockRecordDeepScores).toHaveBeenCalledOnce();
    expect(mockQueueWeakest).toHaveBeenCalledOnce();
    expect(result.recorded).toBe(2);
  });

  it('weakness is lower for higher deep scores', async () => {
    mockDeepScore.mockResolvedValue({
      reporank: { scorer: 'reporank', score: 90, summary: 'A' },
      grader: { scorer: 'grader', score: 80, summary: 'B' },
    });
    await benchmarkRoster();
    // avg 85 → weakness 15
    const metrics = mockRecordRun.mock.calls[0][1] as Array<{ component_slug: string }>;
    const scores = mockRecordRun.mock.calls[0][2] as Record<string, number>;
    expect(metrics.length).toBe(3);
    for (const v of Object.values(scores)) expect(v).toBeLessThan(50);
  });

  it('returns zeros when no targets', async () => {
    mockAgents.mockResolvedValue([]);
    const result = await benchmarkRoster();
    expect(result).toEqual({ run_id: '', measured: 0, recorded: 0, queued: 0, deepScored: 0 });
    expect(mockRecordRun).not.toHaveBeenCalled();
  });
});
