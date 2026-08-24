// ============================================================================
// Command Center — Home control-panel lib (pure unit tests, no network/server)
// ============================================================================
import { describe, expect, it } from 'vitest';
import {
  mergeFeed,
  feedStatusPill,
  sortDiscoveries,
  parsePrometheusGauges,
  gaugeCount,
  gaugeSum,
  gaugeValue,
  tsMs,
  type HeartbeatLike,
  type RepairAttemptLike,
  type JobFeedLike,
  type DiscoveryLike,
} from '@/components/command-center/home-lib';

// ---------------------------------------------------------------------------
// mergeFeed
// ---------------------------------------------------------------------------

function hb(slug: string, up: boolean, last_seen: string): HeartbeatLike {
  return { slug, name: slug, up, last_seen, detail: '' };
}
function rp(signal: string, detectedAt: string, status = 'applied'): RepairAttemptLike {
  return { id: `rp-${signal}`, signal, detectedAt, status, detail: `${signal} detail` };
}
function job(id: string, last_run_at: string, last_run_status = 'success'): JobFeedLike {
  return { id, name: id, last_run_at, last_run_status };
}

describe('mergeFeed', () => {
  it('sorts newest-first across all sources', () => {
    const feed = mergeFeed(
      { a: hb('a', true, '2026-01-01T03:00:00.000Z'), b: hb('b', false, '2026-01-01T01:00:00.000Z') },
      [rp('job:error', '2026-01-01T02:00:00.000Z')],
      [job('j1', '2026-01-01T04:00:00.000Z')],
    );
    expect(feed.map((e) => e.source)).toEqual(['job', 'heartbeat', 'repair', 'heartbeat']);
    expect(feed[0].title).toBe('j1');
  });

  it('caps to the given limit', () => {
    const heartbeats: Record<string, HeartbeatLike> = {};
    for (let i = 0; i < 10; i++) {
      heartbeats[`a${i}`] = hb(`a${i}`, true, `2026-01-01T0${i}:00:00.000Z`);
    }
    expect(mergeFeed(heartbeats, [], [], 3)).toHaveLength(3);
  });

  it('handles absent/null inputs', () => {
    expect(mergeFeed(null, null, null)).toEqual([]);
    expect(mergeFeed(undefined, undefined, undefined, 10)).toEqual([]);
    expect(mergeFeed([], [], [])).toEqual([]);
  });

  it('reflects up/status in the entry', () => {
    const feed = mergeFeed({ a: hb('a', false, '2026-01-01T00:00:00.000Z') }, [], []);
    expect(feed[0].status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// feedStatusPill
// ---------------------------------------------------------------------------

describe('feedStatusPill', () => {
  it('maps known statuses and falls back to gray', () => {
    expect(feedStatusPill('applied')).toContain('text-green-400');
    expect(feedStatusPill('escalated')).toContain('text-red-400');
    expect(feedStatusPill('skipped')).toContain('text-yellow-400');
    expect(feedStatusPill('weird')).toContain('text-gray-400');
    expect(feedStatusPill(null)).toContain('text-gray-400');
  });
});

// ---------------------------------------------------------------------------
// tsMs
// ---------------------------------------------------------------------------

describe('tsMs', () => {
  it('parses timestamps and returns 0 on junk', () => {
    expect(tsMs('2026-01-01T00:00:00.000Z')).toBeGreaterThan(0);
    expect(tsMs(null)).toBe(0);
    expect(tsMs('nonsense')).toBe(0);
    expect(tsMs(undefined)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sortDiscoveries
// ---------------------------------------------------------------------------

function disc(goalId: string, gradedAt: string, score: number): DiscoveryLike {
  return { goalId, domain: 'x', area: 'y', title: goalId, score, evidenceTier: 'A' as never, gradedAt };
}

describe('sortDiscoveries', () => {
  it('sorts by gradedAt then score, capped', () => {
    const input = [
      disc('old', '2026-01-01T00:00:00.000Z', 10),
      disc('new', '2026-01-03T00:00:00.000Z', 50),
      disc('mid', '2026-01-02T00:00:00.000Z', 99),
    ];
    const out = sortDiscoveries(input, 20);
    expect(out.map((d) => d.goalId)).toEqual(['new', 'mid', 'old']);
  });

  it('does not mutate input and handles empty', () => {
    const input = [disc('a', '2026-01-02T00:00:00.000Z', 1), disc('b', '2026-01-01T00:00:00.000Z', 2)];
    const out = sortDiscoveries(input);
    expect(input[0].goalId).toBe('a');
    expect(out[0].goalId).toBe('a');
    expect(sortDiscoveries(null)).toEqual([]);
    expect(sortDiscoveries([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Prometheus parsing
// ---------------------------------------------------------------------------

const SAMPLE = `# HELP draymond_agents_total Agents by status
draymond_agents_total{status="active"} 12
draymond_agents_total{status="degraded"} 3
draymond_repair_attempts_total{status="applied"} 7
draymond_lessons_total 45
not_a_gauge foo`;

describe('parsePrometheusGauges', () => {
  it('parses labeled and unlabeled gauge lines', () => {
    const gauges = parsePrometheusGauges(SAMPLE);
    expect(gaugeCount(gauges, 'draymond_agents_total')).toBe(2);
    expect(gaugeValue(gauges, 'draymond_lessons_total')).toBe(45);
    expect(gauges.find((g) => g.name === 'draymond_agents_total' && g.labels.status === 'active')?.value).toBe(12);
  });

  it('sums across labels', () => {
    expect(gaugeSum(parsePrometheusGauges(SAMPLE), 'draymond_agents_total')).toBe(15);
  });

  it('returns [] for null/empty text', () => {
    expect(parsePrometheusGauges(null)).toEqual([]);
    expect(parsePrometheusGauges('')).toEqual([]);
    expect(parsePrometheusGauges('just some prose')).toEqual([]);
  });
});
