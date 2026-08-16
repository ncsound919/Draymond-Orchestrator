import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST as storeWeightsPOST } from '@/app/api/ops/learning/weights/route';
import { POST as benchmarkPOST } from '@/app/api/ops/learning/benchmark/route';
import { POST as discoveryPOST } from '@/app/api/ops/learning/discovery/route';
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

async function readStore() {
  const res = await storeGET(mockRequest(undefined, AUTH));
  return res.json();
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
    const body = await readStore();
    expect(body.gradeWeights).toEqual(weights);
  });

  it('records a publication event with negative-outcome flag and persists it', async () => {
    const post = await publishedPOST(mockRequest({
      goalId: 'g1', discoveryId: 'd1', source: 'curemind', gradeScore: 180,
    }, AUTH));
    expect(post.status).toBe(200);
    expect(await post.json()).toMatchObject({ outcome: 'low_grade_published' });

    const body = await readStore();
    expect(body.publicationEvents).toHaveLength(1);
    expect(body.publicationEvents[0]).toMatchObject({
      goalId: 'g1', discoveryId: 'd1', gradeScore: 180, outcome: 'low_grade_published',
    });
  });

  it('benchmark endpoint stores facet weights + drift and persists them', async () => {
    const driftMetrics = {
      conceptDriftDetected: true, covariateShiftDetected: false, driftMagnitude: 0.42,
      lastEvaluatedAt: new Date().toISOString(), shiftedFeatures: ['speedAndLatency'],
      recommendedAction: 'recalibrate',
    };
    const post = await benchmarkPOST(mockRequest({
      benchmarkWeights: {
        speedAndLatency: 0.25, securityAndDefense: 0.35, reliabilityAndSla: 0.2,
        costAndEfficiency: 0.2, lastRecalibratedAt: new Date().toISOString(),
        recalibrationReason: 'test',
      },
      driftMetrics,
    }, AUTH));
    expect(post.status).toBe(200);

    const body = await readStore();
    expect(body.benchmarkWeights.speedAndLatency).toBe(0.25);
    expect(body.driftMetrics).toMatchObject({
      conceptDriftDetected: true, driftMagnitude: 0.42,
    });
  });

  it('dedupes discoveries by goalId, keeping the latest write', async () => {
    const first = await discoveryPOST(mockRequest({
      discovery: {
        goalId: 'dg1', domain: 'biotech', area: 'protein', title: 'first title',
        score: 210, evidenceTier: 'experimental', breakthroughClass: 'promising',
        trend: 'up', gradedAt: new Date().toISOString(),
      },
    }, AUTH));
    expect(first.status).toBe(200);

    const second = await discoveryPOST(mockRequest({
      discovery: {
        goalId: 'dg1', domain: 'biotech', area: 'protein', title: 'second title',
        score: 260, evidenceTier: 'validated', breakthroughClass: 'frontier',
        trend: 'flat', gradedAt: new Date().toISOString(),
      },
    }, AUTH));
    expect(second.status).toBe(200);

    const body = await readStore();
    const matches = body.discoveries.filter((d: any) => d.goalId === 'dg1');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('second title');
    expect(matches[0].score).toBe(260);
  });

  it('rejects invalid payloads with 400', async () => {
    const noNovelty = await storeWeightsPOST(mockRequest({ weights: { testability: 0.1 } }, AUTH));
    expect(noNovelty.status).toBe(400);

    const noGoalId = await publishedPOST(mockRequest({ gradeScore: 800 }, AUTH));
    expect(noGoalId.status).toBe(400);

    const nanScore = await publishedPOST(mockRequest({ goalId: 'g2', gradeScore: NaN }, AUTH));
    expect(nanScore.status).toBe(400);

    const noScore = await discoveryPOST(mockRequest({ discovery: { goalId: 'dg9' } }, AUTH));
    expect(noScore.status).toBe(400);
  });
});
