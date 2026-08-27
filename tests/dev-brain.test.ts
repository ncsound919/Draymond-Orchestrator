import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, payload: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })));
}

describe('dev-brain client (primary decision layer)', () => {
  it('reports reachable when /api/health is healthy', async () => {
    stubFetch(200, { status: 'healthy', version: '1.0.0' });
    const { devBrainReachable } = await import('../src/lib/draymond/dev-brain');
    expect(await devBrainReachable()).toBe(true);
  });

  it('reports unreachable on HTTP error (never throws)', async () => {
    stubFetch(500, { error: 'boom' });
    const { devBrainReachable } = await import('../src/lib/draymond/dev-brain');
    expect(await devBrainReachable()).toBe(false);
  });

  it('reports unreachable on network failure (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const { devBrainReachable } = await import('../src/lib/draymond/dev-brain');
    expect(await devBrainReachable()).toBe(false);
  });

  it('returns a weighted decision matrix from /api/decide', async () => {
    const matrix = {
      id: 'matrix_x',
      decisionTopic: 'decide',
      context: 'ctx',
      totalOptionsCount: 2,
      recommendedOptionId: 'goal:A',
      synthesisRationale: 'Recommended goal:A (60%).',
      tradeOffSummary: 'goal:A vs goal:B',
      generatedBy: 'deterministic_engine',
      timestamp: '2026-08-26T00:00:00.000Z',
      normalizedPercentageSum: 100,
      options: [
        { id: 'goal:A', title: 'Advance: A', weightPercentage: 60, confidenceScore: 90, pros: [], cons: [], recommended: true, scores: {}, riskLevel: 'LOW', expectedROI: '1x', timeToValue: '1w', verdictTag: 'STRONGLY_RECOMMENDED', mitigationStrategy: '', supportingLeaders: [] },
        { id: 'goal:B', title: 'Advance: B', weightPercentage: 40, confidenceScore: 80, pros: [], cons: [], recommended: false, scores: {}, riskLevel: 'LOW', expectedROI: '1x', timeToValue: '1w', verdictTag: 'VIABLE', mitigationStrategy: '', supportingLeaders: [] },
      ],
    };
    stubFetch(200, matrix);
    const { devBrainDecide } = await import('../src/lib/draymond/dev-brain');
    const result = await devBrainDecide({ problem: 'p', candidates: [{ id: 'goal:A', title: 'A', description: 'a', tags: ['agenda'] }] });
    expect(result?.recommendedOptionId).toBe('goal:A');
    expect(result?.options).toHaveLength(2);
  });

  it('returns null for a malformed matrix (never throws)', async () => {
    stubFetch(200, { not: 'a matrix' });
    const { devBrainDecide } = await import('../src/lib/draymond/dev-brain');
    expect(await devBrainDecide({ problem: 'p' })).toBeNull();
  });
});