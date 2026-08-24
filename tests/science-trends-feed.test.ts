import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// The trends feed writes through the draymond.db connection; keep the whole
// suite in-memory so tests never touch data/draymond.db. Must run before any
// module import triggers a connection.
vi.hoisted(() => {
  process.env.DRAYMOND_DB_PATH = ':memory:';
});

// Stubbed executor output: a full InsightReport payload exactly as
// sports_science/run_insights.py prints it (flat dict, graded evidence tier).
const { INSIGHT_PAYLOAD } = vi.hoisted(() => ({
  INSIGHT_PAYLOAD: {
    from_domain: 'sports',
    to_domain: 'biotech',
    source_read: 'efficiency TER 1.20; injury risk 30%',
    target_read: 'As a biotech/tumor profile, high proliferation; controlled recurrence signal.',
    translated_metrics: [
      {
        metric: 'ter',
        source_value: 1.2,
        target_metric: 'tumor_efficiency_ratio',
        target_value: 1.2,
        confidence: 0.9,
        note: 'TER -> tumor efficiency',
      },
      {
        metric: 'gravity',
        source_value: 0.6,
        target_metric: 'tumor_gravity',
        target_value: 0.6,
        confidence: 0.7,
        note: 'gravity <-> tumor_gravity',
      },
    ],
    archetype: 'jordan',
    archetype_translation: 'oncogene',
    confidence: 0.8,
    evidence_tier: 'E2',
  },
}));

// Mock approach of the sports executor suites: stub child_process.execFile so
// runPythonInsights "runs" the Python CLI and prints the stubbed payload.
vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    _args: string[],
    _opts: unknown,
    cb: (err: unknown, result: { stdout: string }) => void,
  ) => cb(null, { stdout: JSON.stringify(INSIGHT_PAYLOAD) }),
}));

import { POST as persistPost } from '@/app/api/v1/science/insights/persist/route';
import { runPythonInsights } from '@/lib/sports/pythonExecutors';
import { listInsights, persistInsightReport } from '@/lib/science/trendsFeed';
import { getDb } from '@/lib/db/connection';

function makeRequest(url: string, init: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function persistReq(body: unknown): NextRequest {
  return makeRequest('http://localhost/api/v1/science/insights/persist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify(body),
  });
}

describe('science trends feed (bbtech InsightReport persistence)', () => {
  beforeAll(() => {
    process.env.CRON_SECRET = 'test-secret';
  });

  beforeEach(() => {
    getDb().prepare('DELETE FROM science_insights').run();
  });

  it('persists an executor report into a row retrievable via the trends query', async () => {
    const res = await runPythonInsights({
      ter: 1.2,
      four_factors: { proliferation: 70, clearance: 40, resource: 55, metastasis: 45 },
      gravity: 0.6,
      flow: 0.5,
    });
    expect(res.success).toBe(true);
    expect(res.persisted?.ok).toBe(true);
    expect(res.persisted?.duplicate).toBe(false);

    // Retrievable via the list query consumers use...
    const rows = await listInsights({ source: 'bbtech' });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('bbtech');
    expect(rows[0].domain).toBe('sports');
    const report = rows[0].report as Record<string, unknown>;
    expect(report.from_domain).toBe('sports');
    expect(Array.isArray(report.translated_metrics)).toBe(true);

    // ...and retrievable via the raw table read (same store).
    const raw = getDb()
      .prepare("SELECT session_id, generated_at FROM science_insights WHERE source = 'bbtech'")
      .all() as Array<{ session_id: string; generated_at: string }>;
    expect(raw).toHaveLength(1);
    expect(raw[0].generated_at).toBeTruthy();
  });

  it('is idempotent on (sessionId, generatedAt): second call updates instead of duplicating', async () => {
    const meta = { source: 'bbtech', sessionId: 'sess-1', generatedAt: '2026-08-24T00:00:00.000Z' };
    const first = await persistInsightReport(INSIGHT_PAYLOAD, meta);
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);

    const mutated = { ...(INSIGHT_PAYLOAD as Record<string, unknown>), confidence: 0.95 };
    const second = await persistInsightReport(mutated, meta);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);

    const rows = await listInsights({ source: 'bbtech' });
    expect(rows).toHaveLength(1);
    expect((rows[0].report as Record<string, unknown>).confidence).toBe(0.95);
  });

  it('passes evidence_tier end-to-end from stubbed executor output to the stored row', async () => {
    const res = await runPythonInsights({ ter: 1.2 });
    expect(res.success).toBe(true);
    // Executor wrapper reports its rule-based E3 tag, but the persisted row
    // carries the Python-graded tier from the report payload.
    expect(res.evidence_tier).toBe('E3');
    expect(res.persisted?.ok).toBe(true);

    const rows = await listInsights({ source: 'bbtech' });
    expect(rows[0].evidence_tier).toBe('E2');
  });

  it('fails honestly on an invalid report instead of persisting garbage', async () => {
    const missing = await persistInsightReport({}, { source: 'bbtech' });
    expect(missing.ok).toBe(false);
    expect(String(missing.error)).toContain('from_domain');

    const badTier = await persistInsightReport(INSIGHT_PAYLOAD, { evidenceTier: 'E9' });
    expect(badTier.ok).toBe(false);
    expect(String(badTier.error)).toContain('invalid evidence_tier');

    expect(await listInsights()).toHaveLength(0);
  });

  it('route persists a posted report and returns duplicate on re-post', async () => {
    const body = {
      report: INSIGHT_PAYLOAD,
      session_id: 'backfill-1',
      generated_at: '2026-08-24T12:00:00.000Z',
      domain: 'sports',
    };
    const first = await persistPost(persistReq(body));
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson.ok).toBe(true);
    expect(firstJson.duplicate).toBe(false);

    const second = await persistPost(persistReq(body));
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.ok).toBe(true);
    expect(secondJson.duplicate).toBe(true);
    expect(secondJson.id).toBe(firstJson.id);

    expect(await listInsights({ source: 'bbtech' })).toHaveLength(1);
  });

  it('route rejects an invalid report with a 400 and an error message', async () => {
    const res = await persistPost(persistReq({ report: { confidence: 'high' } }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(String(json.error)).toContain('from_domain');
  });
});
