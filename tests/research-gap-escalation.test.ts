import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NextRequest } from 'next/server';

// Keep the whole suite in-memory so tests never touch data/draymond.db.
// Must run before any module import triggers a connection.
vi.hoisted(() => {
  process.env.DRAYMOND_DB_PATH = ':memory:';
});

process.env.CRON_SECRET = 'test-secret';

// Pin the .draymond brain dir to a throwaway temp dir so the REAL brain state
// is never written (escalateGaps reads the override at call time).
const BRAIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gap-brain-'));
process.env.DRAYMOND_REGISTRY_DIR = BRAIN_DIR;

const GAP = {
  gap_id: 'gap_abc123',
  kind: 'unknown',
  title: 'pose model missing',
  detail: 'structured unavailable result: pose model missing',
  source_ref: '$.vision',
  evidence_tier: 'E4',
  severity: 4,
  detected_at: '2026-08-24T00:00:00Z',
};

function seedBrainFile(file: string, key: string, entries: unknown[]): void {
  fs.writeFileSync(
    path.join(BRAIN_DIR, file),
    JSON.stringify({ [key]: entries, updatedAt: '2026-01-01T00:00:00.000Z' }, null, 2),
  );
}

function readBrainFile(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(BRAIN_DIR, file), 'utf-8')) as Record<string, unknown>;
}

function makeRequest(url: string, init: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CRON_SECRET}`,
  };
}

describe('research gap escalation', () => {
  beforeAll(() => {
    // Seed pre-existing brain state so append-preservation is provable.
    seedBrainFile('hypotheses.json', 'hypotheses', [
      { id: 'biotech-01-h1', goal_id: 'biotech-01', claim: 'pre-existing hypothesis', status: 'untested', experiment_ids: [] },
    ]);
    seedBrainFile('experiment-queue.json', 'queue', [
      { id: 'ca1ea44e-acb8-451c-a87a-d99705cef2a8', goal_id: 'biotech-03', status: 'queued' },
    ]);
  });

  beforeEach(async () => {
    const { getDb } = await import('@/lib/db/connection');
    getDb().prepare('DELETE FROM science_gaps').run();
  });

  it('escalates a gap into an open science_gaps row + brain appends', async () => {
    const { escalateGaps } = await import('@/lib/science/researchEscalation');

    const res = await escalateGaps([GAP]);
    expect(res.ok).toBe(true);
    expect(res.escalated).toBe(1);
    expect(res.duplicates).toBe(0);
    expect(res.hypothesesAppended).toBe(1);
    expect(res.experimentsAppended).toBe(1);

    const { listGaps } = await import('@/lib/science/researchEscalation');
    const gaps = await listGaps({ status: 'open' });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ gap_id: GAP.gap_id, kind: 'unknown', severity: 4, status: 'open' });

    // Brain appends preserve existing file contents and use hyp_/exp_ slugs.
    const hypotheses = readBrainFile('hypotheses.json') as { hypotheses: Array<Record<string, unknown>> };
    expect(hypotheses.hypotheses.some((h) => h.id === 'biotech-01-h1')).toBe(true);
    const hypEntry = hypotheses.hypotheses.find((h) => h.id === 'hyp_unknown-pose-model-missing');
    expect(hypEntry).toBeDefined();
    expect(hypEntry?.status).toBe('untested');

    const queue = readBrainFile('experiment-queue.json') as { queue: Array<Record<string, unknown>> };
    expect(queue.queue.some((e) => e.id === 'ca1ea44e-acb8-451c-a87a-d99705cef2a8')).toBe(true);
    const expEntry = queue.queue.find((e) => e.id === 'exp_unknown-pose-model-missing');
    expect(expEntry).toBeDefined();
    expect(expEntry?.status).toBe('queued');
  });

  it('is idempotent on re-escalation: no duplicate rows or brain entries', async () => {
    const { escalateGaps } = await import('@/lib/science/researchEscalation');

    await escalateGaps([GAP]);
    const second = await escalateGaps([GAP]);
    expect(second.ok).toBe(true);
    expect(second.escalated).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(second.hypothesesAppended).toBe(0);
    expect(second.experimentsAppended).toBe(0);

    const { listGaps } = await import('@/lib/science/researchEscalation');
    expect(await listGaps()).toHaveLength(1);

    const queue = readBrainFile('experiment-queue.json') as { queue: unknown[] };
    expect(queue.queue.filter((e) => (e as Record<string, unknown>).id === 'exp_unknown-pose-model-missing')).toHaveLength(1);
  });

  it('lifecycle moves open -> researching -> resolved', async () => {
    const { escalateGaps, transitionGap, listGaps } = await import('@/lib/science/researchEscalation');
    await escalateGaps([GAP]);

    const research = await transitionGap(GAP.gap_id, 'research');
    expect(research.ok).toBe(true);
    expect(research.gap?.status).toBe('researching');
    expect(research.gap?.dispatched_at).toBeTruthy();

    const resolve = await transitionGap(GAP.gap_id, 'resolve');
    expect(resolve.ok).toBe(true);
    expect(resolve.gap?.status).toBe('resolved');
    // Resolve keeps the original dispatch timestamp.
    expect(resolve.gap?.dispatched_at).toBe(research.gap?.dispatched_at);

    const open = await listGaps({ status: 'open' });
    expect(open).toHaveLength(0);
  });

  it('offline dispatch keeps the gap open and returns queued:true', async () => {
    const { escalateGaps, dispatchToResearch, transitionGap } = await import('@/lib/science/researchEscalation');
    await escalateGaps([GAP]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3010')),
    );
    try {
      const res = await dispatchToResearch({
        ...GAP,
        status: 'open',
        payload: GAP,
        dispatched_at: null,
        created_at: GAP.detected_at,
        updated_at: GAP.detected_at,
      });
      expect(res.ok).toBe(false);
      expect(res.queued).toBe(true);

      // Never lost: the row stays open for the next drain pass.
      const after = await transitionGap(GAP.gap_id, 'research');
      expect(after.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('online dispatch flips the row to researching', async () => {
    const { escalateGaps, dispatchToResearch, listGaps } = await import('@/lib/science/researchEscalation');
    await escalateGaps([GAP]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    try {
      const res = await dispatchToResearch({
        ...GAP,
        status: 'open',
        payload: GAP,
        dispatched_at: null,
        created_at: GAP.detected_at,
        updated_at: GAP.detected_at,
      });
      expect(res.ok).toBe(true);
      expect(res.status).toBe('researching');

      const rows = await listGaps({ status: 'researching' });
      expect(rows).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('research gap routes', () => {
  beforeEach(async () => {
    const { getDb } = await import('@/lib/db/connection');
    getDb().prepare('DELETE FROM science_gaps').run();
  });

  it('GET lists escalated gaps and filters by status', async () => {
    const { GET } = await import('@/app/api/v1/science/gaps/route');
    const { escalateGaps } = await import('@/lib/science/researchEscalation');
    await escalateGaps([GAP]);

    const res = await GET(makeRequest('http://localhost/api/v1/science/gaps?status=open', {
      headers: authHeaders(),
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.gaps).toHaveLength(1);
    expect(json.gaps[0].gap_id).toBe(GAP.gap_id);
  });

  it('POST escalate backfills gaps and rejects a missing payload with 400', async () => {
    const { POST } = await import('@/app/api/v1/science/gaps/escalate/route');

    const good = await POST(makeRequest('http://localhost/api/v1/science/gaps/escalate', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ gaps: [GAP] }),
    }));
    expect(good.status).toBe(200);
    const goodJson = await good.json();
    expect(goodJson.ok).toBe(true);
    expect(goodJson.escalated).toBe(1);

    const bad = await POST(makeRequest('http://localhost/api/v1/science/gaps/escalate', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).ok).toBe(false);
  });

  it('POST :id/:op transitions and 404s unknown ids', async () => {
    const { POST } = await import('@/app/api/v1/science/gaps/[id]/[op]/route');
    const { escalateGaps } = await import('@/lib/science/researchEscalation');
    await escalateGaps([GAP]);

    const ok = await POST(
      makeRequest(`http://localhost/api/v1/science/gaps/${GAP.gap_id}/research`, {
        method: 'POST',
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: GAP.gap_id, op: 'research' }) },
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).gap.status).toBe('researching');

    const missing = await POST(
      makeRequest('http://localhost/api/v1/science/gaps/gap_nope/resolve', {
        method: 'POST',
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: 'gap_nope', op: 'resolve' }) },
    );
    expect(missing.status).toBe(404);

    const badOp = await POST(
      makeRequest(`http://localhost/api/v1/science/gaps/${GAP.gap_id}/explode`, {
        method: 'POST',
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: GAP.gap_id, op: 'explode' }) },
    );
    expect(badOp.status).toBe(400);
  });

  it('rejects unauthenticated route access', async () => {
    const { GET } = await import('@/app/api/v1/science/gaps/route');
    const res = await GET(makeRequest('http://localhost/api/v1/science/gaps', { headers: {} }));
    expect(res.status).toBe(401);
  });
});
