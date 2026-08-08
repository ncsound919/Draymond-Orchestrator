import { describe, expect, it, vi, afterEach } from 'vitest';

describe('roster benchmark stats', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('@/lib/registry/agent-store');
    vi.doUnmock('../src/lib/draymond/client');
  });

  it('derives roster stat bars from a deep-score snapshot', async () => {
    const { statsFromSnapshot } = await import('../src/lib/draymond/roster-stats');
    const stats = statsFromSnapshot({
      weakness_score: 20,
      deep_scores: {
        reporank: { scorer: 'reporank', score: 78, summary: 'ok' },
        grader: { scorer: 'grader', score: 88, summary: 'ok' },
        'vibe-reality': { scorer: 'vibe-reality', score: null, summary: '', error: 'down' },
      },
    });
    expect(stats).toEqual([
      { label: 'RepoRank', value: 78 },
      { label: 'Grader', value: 88 },
      { label: 'Health', value: 80 },
    ]);
  });

  it('skips null scores and clamps to 0-100', async () => {
    const { statsFromSnapshot } = await import('../src/lib/draymond/roster-stats');
    const stats = statsFromSnapshot({ weakness_score: 130, deep_scores: { reporank: { scorer: 'reporank', score: 250, summary: 'x' } } });
    expect(stats).toEqual([
      { label: 'RepoRank', value: 100 },
      { label: 'Health', value: 0 },
    ]);
  });

  it('computes % gains between two deep-scored runs', async () => {
    const rows = [
      // Newest first: current run has reporank 90 (up from 60), grader 50 (down from 80).
      { component_name: 'uplift-agent', weakness_score: 10, deep_scores: { reporank: { score: 90 }, grader: { score: 50 } }, run_at: '2026-08-07T00:00:00Z' },
      { component_name: 'uplift-agent', weakness_score: 40, deep_scores: { reporank: { score: 60 }, grader: { score: 80 } }, run_at: '2026-08-01T00:00:00Z' },
    ];
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(async () => ({ data: rows, error: null })),
              })),
            })),
          })),
        })),
      })),
    };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { computeBenchmarkGains } = await import('../src/lib/draymond/roster-stats');

    const gains = await computeBenchmarkGains('entity', 'uplift-agent');
    const reporank = gains.find((g) => g.scorer === 'reporank')!;
    const grader = gains.find((g) => g.scorer === 'grader')!;
    const weakness = gains.find((g) => g.scorer === 'weakness')!;

    expect(reporank.baseline).toBe(60);
    expect(reporank.current).toBe(90);
    expect(reporank.gainPct).toBe(50); // (90-60)/60*100

    expect(grader.baseline).toBe(80);
    expect(grader.current).toBe(50);
    expect(grader.gainPct).toBe(-37.5); // (50-80)/80*100

    // Weakness inverted: 40 -> 10 weaknesses means the health score rose.
    expect(weakness.baseline).toBe(60);
    expect(weakness.current).toBe(90);
    expect(weakness.gainPct).toBe(50);
  });

  it('returns an empty list when a component has no runs', async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(async () => ({ data: [], error: null })),
              })),
            })),
          })),
        })),
      })),
    };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { computeBenchmarkGains } = await import('../src/lib/draymond/roster-stats');
    expect(await computeBenchmarkGains('entity', 'missing')).toEqual([]);
  });

  it('reads the latest deep-scored benchmark per component only', async () => {
    const rows = [
      { component_class: 'entity', component_slug: 'a', component_name: 'A', weakness_score: 5, deep_scores: { reporank: { score: 88 } }, run_at: '2026-08-07T00:00:00Z' },
      { component_class: 'entity', component_slug: 'a', component_name: 'A', weakness_score: 9, deep_scores: { reporank: { score: 70 } }, run_at: '2026-08-01T00:00:00Z' },
      { component_class: 'entity', component_slug: 'b', component_name: 'B', weakness_score: 3, deep_scores: {}, run_at: '2026-08-07T00:00:00Z' },
      { component_class: 'site', component_slug: 'c', component_name: 'C', weakness_score: 0, deep_scores: { grader: { score: 60 } }, run_at: '2026-08-07T00:00:00Z' },
    ];
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: rows, error: null })),
          })),
        })),
      })),
    };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { latestDeepScoredBenchmarks } = await import('../src/lib/draymond/roster-stats');
    const snapshots = await latestDeepScoredBenchmarks();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.find((s) => s.component_slug === 'a')?.deep_scores.reporank.score).toBe(88);
    expect(snapshots.find((s) => s.component_slug === 'c')?.component_class).toBe('site');
  });
});
