import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST as storeWeightsPOST } from '@/app/api/ops/learning/weights/route';
import { POST as benchmarkPOST } from '@/app/api/ops/learning/benchmark/route';
import { POST as publishedPOST } from '@/app/api/ops/learning/published/route';
import { GET as storeGET } from '@/app/api/ops/learning/store/route';

const AUTH = { Authorization: 'Bearer test-secret' };

function mockRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: new Headers(headers),
    url: 'http://localhost/api/ops/learning/store',
  } as unknown as NextRequest;
}

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret';
  process.env.DRAYMOND_REGISTRY_DIR = `/tmp/lr-test-${Date.now()}`;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.DRAYMOND_REGISTRY_DIR;
});

describe('learning HTTP surface', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await storeGET(mockRequest(undefined, {}));
    expect(res.status).toBe(401);
  });

  it('publishes grade weights and reads them back via store GET', async () => {
    const weights = { novelty: 0.3, testability: 0.1, evidence: 0.25, impact: 0.2, maturity: 0.05, crossDomain: 0.1 };
    const post = await storeWeightsPOST(mockRequest({ weights }, AUTH));
    expect(post.status).toBe(200);
    const get = await storeGET(mockRequest(undefined, AUTH));
    const body = await get.json();
    expect(body.gradeWeights).toEqual(weights);
  });

  it('records a publication event with negative-outcome flag', async () => {
    const post = await publishedPOST(mockRequest({
      goalId: 'g1', discoveryId: 'd1', source: 'curemind', gradeScore: 180,
    }, AUTH));
    expect(post.status).toBe(200);
  });

  it('benchmark endpoint stores facet weights + drift', async () => {
    const post = await benchmarkPOST(mockRequest({
      benchmarkWeights: {
        speedAndLatency: 0.25, securityAndDefense: 0.35, reliabilityAndSla: 0.2,
        costAndEfficiency: 0.2, lastRecalibratedAt: new Date().toISOString(),
        recalibrationReason: 'test',
      },
      driftMetrics: null,
    }, AUTH));
    expect(post.status).toBe(200);
  });
});
