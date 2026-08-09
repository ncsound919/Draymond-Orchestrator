import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addOpportunity,
  listOpportunities,
  updateOpportunityStage,
  pipelineSummary,
  MONTHLY_TARGET,
} from '../src/lib/draymond/business-pipeline';

// Hermetic env: business-pipeline.json lives in the .draymond registry.
// Use a temp dir so tests never touch (or clobber) the real seeded pipeline.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-pipeline-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

beforeAll(() => {
  process.env.DRAYMOND_REGISTRY_DIR = tmp;
});

beforeEach(() => {
  const f = path.join(tmp, 'business-pipeline.json');
  if (fs.existsSync(f)) fs.rmSync(f, { force: true });
});

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('business pipeline (mission control)', () => {
  it('targets $33k/month across four engines', () => {
    expect(MONTHLY_TARGET).toBe(33_000);
  });

  it('adds opportunities and computes pipeline value by stage', async () => {
    await addOpportunity({
      name: 'Aetherdesk - Dental', engine: 'E2-b2b', stage: 'proposal', monthlyValue: 250,
      owner: 'aetherdesk', nextAction: 'send proposal',
    });
    await addOpportunity({
      name: 'QA - Client A', engine: 'E3-tooling', stage: 'won', monthlyValue: 300,
      owner: 'overlay-auditor', nextAction: '',
    });
    const summary = await pipelineSummary(5_000);
    expect(summary.opportunities.total).toBe(2);
    expect(summary.opportunities.activePipelineValue).toBe(250);
    expect(summary.opportunities.wonMonthlyValue).toBe(300);
    expect(summary.byEngine['E2-b2b'].active).toBe(250);
    expect(summary.byEngine['E3-tooling'].won).toBe(300);
    expect(summary.revenueToDate).toBe(5_000);
    // Mission strategy (DEFAULT_STRATEGY) drives the target: $5k/mo × 3 = $15k over 90 days.
    expect(summary.missionMonthlyTarget).toBe(5_000);
    expect(summary.requiredDaily).toBe(Math.round((15_000 - 5_000) / 90));
  });

  it('moves an opportunity to won via stage update', async () => {
    const opp = await addOpportunity({
      name: 'Security Audit', engine: 'E3-tooling', stage: 'lead', monthlyValue: 500,
      owner: 'depscan', nextAction: 'qualify',
    });
    const updated = await updateOpportunityStage(opp.id, 'won');
    expect(updated?.stage).toBe('won');
    const summary = await pipelineSummary(0);
    expect(summary.opportunities.wonMonthlyValue).toBe(500);
  });

  it('lists opportunities', async () => {
    await addOpportunity({
      name: 'Marketing Retainer', engine: 'E2-b2b', stage: 'lead', monthlyValue: 1000,
      owner: 'social-media-dashboard', nextAction: 'call',
    });
    const ops = await listOpportunities();
    expect(ops.length).toBe(1);
    expect(ops[0]!.owner).toBe('social-media-dashboard');
  });
});
