import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST as insightsPost } from '@/app/api/v1/translate/insights/route';

const { mockPython } = vi.hoisted(() => ({
  mockPython: {
    runPythonTranslate: vi
      .fn()
      .mockResolvedValue({ success: true, data: { data: [{ target_term: 'Transfection Efficiency' }] }, error: null, evidence_tier: 'E3' }),
    runPythonInsights: vi
      .fn()
      .mockResolvedValue({ success: true, data: { data: [{ from_domain: 'sports', to_domain: 'biotech', target_read: 'tumor implication' }] }, error: null, evidence_tier: 'E3' }),
  },
}));

vi.mock('@/lib/sports/pythonExecutors', () => mockPython);

function makeRequest(url: string, init: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function authHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CRON_SECRET}`,
    ...overrides,
  };
}

function insightsReq(body: unknown): NextRequest {
  return makeRequest('http://localhost/api/v1/translate/insights', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

describe('translate/insights endpoint', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    mockPython.runPythonTranslate.mockClear();
    mockPython.runPythonInsights.mockClear();
  });

  it('synthesizes insights from a profile by default', async () => {
    const res = await insightsPost(
      insightsReq({
        profile: {
          ter: 1.2,
          four_factors: { proliferation: 70, clearance: 40, resource: 55, metastasis: 45 },
          gravity: 0.6,
          flow: 0.5,
          fatigue: 40,
          injury_risk: 0.3,
          recovery_priority: 'high',
          archetype: 'jordan',
        },
      }),
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockPython.runPythonInsights).toHaveBeenCalledTimes(1);
    expect(json.data[0].to_domain).toBe('biotech');
  });

  it('accepts a from_domain override', async () => {
    const res = await insightsPost(
      insightsReq({
        from_domain: 'biotech',
        profile: { ter: 1.1, tumor_gravity: 0.55, tumor_flow: 0.5, risk_tier: 'high' },
      }),
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockPython.runPythonInsights).toHaveBeenCalledWith(expect.any(Object), true);
  });

  it('translates a single term when mode=translate', async () => {
    const res = await insightsPost(insightsReq({ mode: 'translate', term: 'FG_PCT', value: 45.5 }));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockPython.runPythonTranslate).toHaveBeenCalledWith('FG_PCT', 45.5, true);
  });

  it('rejects an empty profile', async () => {
    const res = await insightsPost(insightsReq({ profile: {} }));
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('profile required');
  });
});
