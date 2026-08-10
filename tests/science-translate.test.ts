import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST as formulaPost } from '@/app/api/v1/science/formula/route';
import { POST as translatePost } from '@/app/api/v1/science/translate/route';

const { mockPython } = vi.hoisted(() => ({
  mockPython: {
    runPythonFormula: vi.fn().mockResolvedValue({
      success: true,
      data: { data: [{ key: 'PER', value: 75.3, biotech_analog: 'Viability-Efficiency Composite', evidence_tier: 'E1' }] },
      error: null,
      evidence_tier: 'E1',
    }),
    runPythonLayers: vi.fn().mockResolvedValue({
      success: true,
      data: { data: [{ layer: 'strategy', source_term: 'small-ball lineup', target_term: 'low-density tumor microenvironment strategy' }] },
      error: null,
      evidence_tier: 'E3',
    }),
  },
}));

vi.mock('@/lib/sports/pythonExecutors', () => mockPython);

function authHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CRON_SECRET}`,
    ...overrides,
  };
}

function makeRequest(url: string, init: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

const BOX = { FG: 10, FGA: 18, '3P': 3, FT: 5, FTA: 6, REB: 8, AST: 6, STL: 1, BLK: 1, TOV: 2, PF: 2, PTS: 28, MP: 36 };

describe('science formula endpoint', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    mockPython.runPythonFormula.mockClear();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await formulaPost(makeRequest('http://localhost/api/v1/science/formula', { headers: {} }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when box score is missing', async () => {
    const res = await formulaPost(
      makeRequest('http://localhost/api/v1/science/formula', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ stat: 'PER' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('computes a formula from a box score', async () => {
    const res = await formulaPost(
      makeRequest('http://localhost/api/v1/science/formula', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ box: BOX, stat: 'PER' }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mockPython.runPythonFormula).toHaveBeenCalledWith(BOX, 'PER');
  });
});

describe('science translate endpoint', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    mockPython.runPythonLayers.mockClear();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await translatePost(makeRequest('http://localhost/api/v1/science/translate', { headers: {} }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when terms are missing', async () => {
    const res = await translatePost(
      makeRequest('http://localhost/api/v1/science/translate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ layer: 'strategy' }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('translates terms across layers', async () => {
    const res = await translatePost(
      makeRequest('http://localhost/api/v1/science/translate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ terms: ['small-ball lineup'], layer: 'all' }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mockPython.runPythonLayers).toHaveBeenCalledWith(['small-ball lineup'], 'all', true);
  });
});
