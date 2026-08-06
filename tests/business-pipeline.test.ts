import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  addOpportunity,
  listOpportunities,
  updateOpportunityStage,
  pipelineSummary,
  MONTHLY_TARGET,
} from '../src/lib/draymond/business-pipeline';

const FILES = ['business-pipeline.json'];

describe('business pipeline (mission control)', () => {
  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    for (const f of FILES) {
      await fs.rm(path.join('.draymond', f), { force: true });
    }
  });

  afterEach(async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    for (const f of FILES) {
      await fs.rm(path.join('.draymond', f), { force: true });
    }
  });

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
    expect(summary.requiredDaily).toBe(Math.round((99_000 - 5_000) / 90));
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
