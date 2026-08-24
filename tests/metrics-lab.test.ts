import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { runPythonDerive } from '@/lib/sports/pythonExecutors';
import { listInsights } from '@/lib/science/trendsFeed';
import { POST as derivePost } from '@/app/api/v1/science/metrics/derive/route';

// Insight derive runs auto-persist into the trends store; keep that in-memory
// so the regression suite never writes rows into the dev draymond.db.
process.env.DRAYMOND_DB_PATH = ':memory:';
process.env.CRON_SECRET = 'test-secret';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: execFileMock };
});

function mockRunner(stdout: string): void {
  execFileMock.mockImplementation(
    (
      _file: unknown,
      _args: unknown,
      _opts: unknown,
      cb: (err: unknown, out: { stdout: string }) => void,
    ) => {
      cb(null, { stdout });
    },
  );
}

const LAB_PAYLOAD = {
  ok: true,
  session_id: 'sess-42',
  domain: 'sports',
  generated_at: '2026-08-24T12:00:00Z',
  metrics: [
    {
      name: 'translation_delta_index',
      value: 0.25,
      unit: 'index',
      inputs_used: ['ter', 'domain', 'generated_at'],
      evidence_tier: 'E2',
    },
    {
      name: 'archetype_pressure_score',
      value: { jordan: 0.5625 },
      unit: 'score',
      inputs_used: ['gravity', 'flow', 'archetype'],
      evidence_tier: 'E3',
    },
  ],
};

function req(body: unknown): NextRequest {
  return new Request('http://localhost/api/v1/science/metrics/derive', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('metrics lab python executor', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('parses runner output and persists rows tagged metric_kind=derived', async () => {
    mockRunner(JSON.stringify(LAB_PAYLOAD));
    const result = await runPythonDerive('sess-42', { ter: 1.0 }, 'sports');
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data.data)).toBe(true);
    expect(result.data.data[0]).toHaveProperty('session_id', 'sess-42');
    // Worst per-metric tier (E2 vs E3) becomes the row tier.
    expect(result.evidence_tier).toBe('E3');
    expect(result.persisted?.ok).toBe(true);

    const rows = await listInsights({ source: 'bbtech_metrics_lab' });
    const row = rows.find((r) => r.session_id === 'sess-42');
    expect(row).toBeDefined();
    expect(row!.report.metric_kind).toBe('derived');
    expect(row!.domain).toBe('sports');

    const [, args] = execFileMock.mock.calls[0];
    expect(args[0]).toMatch(/run_derive\.py$/);
    expect(args.slice(1)).toEqual(['sess-42', expect.any(String), '--domain', 'sports']);
  });

  it('fails honestly when the runner prints non-JSON output', async () => {
    mockRunner('not-json{{');
    const result = await runPythonDerive('sess-42', { ter: 1.0 }, 'sports');
    expect(result.success).toBe(false);
    expect(String(result.error).length).toBeGreaterThan(0);
    expect(result.data.data).toEqual([]);
    expect(result.data.error).toBeDefined();
  });

  it('propagates a structured runner error', async () => {
    mockRunner(JSON.stringify({ ok: false, error: 'profile not found' }));
    const result = await runPythonDerive('sess-42', '/nope.json');
    expect(result.success).toBe(false);
    expect(result.error).toBe('profile not found');
  });

  it('rejects a runner payload with no metrics array content', async () => {
    mockRunner(JSON.stringify({ ok: true, session_id: 's', domain: 'sports', metrics: [] }));
    const result = await runPythonDerive('s', { ter: 1.0 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('no metrics');
  });

  it('requires a session id before touching python', async () => {
    const result = await runPythonDerive('   ');
    expect(result.success).toBe(false);
    expect(result.error).toBe('session_id required');
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/science/metrics/derive', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('runs a happy-path derive and reports persistence', async () => {
    mockRunner(JSON.stringify(LAB_PAYLOAD));
    const res = await derivePost(req({ session_id: 'route-1', domain: 'sports', profile: { ter: 1.0 } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data[0].metrics).toHaveLength(2);
    expect(json.persisted.ok).toBe(true);
  });

  it('returns 400 when session_id is missing', async () => {
    const res = await derivePost(req({ domain: 'sports' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('session_id required');
  });

  it('returns 400 for a malformed profile field', async () => {
    const res = await derivePost(req({ session_id: 'route-2', profile: [1, 2] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('profile must be an object or a path string');
  });
});
