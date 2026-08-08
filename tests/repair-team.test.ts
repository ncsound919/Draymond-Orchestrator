import { describe, expect, it } from 'vitest';
import { classifyFailure, assembleCrew, repairFailedJob } from '../src/lib/draymond/repair-team';

describe('repair team', () => {
  it('classifies chain config failures', () => {
    expect(classifyFailure('chain job missing job_config.chain_slug')).toBe('chain_config');
  });

  it('classifies notification config failures', () => {
    expect(classifyFailure('notification job missing required job_config.payload (recipient, subject, body)')).toBe('notification_config');
  });

  it('assembles a coding crew for config failures', () => {
    const crew = assembleCrew('chain_config');
    expect(crew.lead).toBe('opencode');
    expect(crew.members).toContain('megacode');
    expect(crew.members).toContain('big-homie');
    expect(crew.members).toContain('reporank');
  });

  it('fixes a chain job by rewriting chain -> chain_slug', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const report = await repairFailedJob(
      { id: 'j1', name: 'Evening Marketing Prep', job_type: 'chain', job_config: { chain: 'marketing-pulse' } },
      'chain job missing job_config.chain_slug',
      { updateJobConfig: async (id, config) => { updates.push(config); } },
    );
    expect(report.action).toBe('fixed');
    expect(updates[0]!.chain_slug).toBe('marketing-pulse');
    expect(updates[0]!).not.toHaveProperty('chain');
  });

  it('fixes a notification job by wrapping type into payload', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const report = await repairFailedJob(
      { id: 'j2', name: 'Daily Health Digest', job_type: 'notification', job_config: { type: 'health_summary' } },
      'notification job missing required job_config.payload',
      { updateJobConfig: async (id, config) => { updates.push(config); } },
    );
    expect(report.action).toBe('fixed');
    expect(updates[0]!.payload).toEqual({ type: 'health_summary' });
  });

  it('escalates missing-env failures to the crew lead', async () => {
    const report = await repairFailedJob(
      { id: 'j3', name: 'X', job_type: 'custom', job_config: {} },
      'NEWSAPI_KEY not configured',
      { updateJobConfig: async () => {} },
    );
    expect(report.action).toBe('escalated');
    expect(report.failureKind).toBe('missing_env');
  });

  it('carries distilled lesson hints into the repair report', async () => {
    const report = await repairFailedJob(
      { id: 'j4', name: 'Evening Marketing Prep', job_type: 'chain', job_config: { chain: 'marketing-pulse' } },
      'chain job missing job_config.chain_slug',
      { updateJobConfig: async () => {} },
      ['Repeated failure: "Evening Marketing Prep" (3/3).'],
    );
    expect(report.lessonHints).toEqual(['Repeated failure: "Evening Marketing Prep" (3/3).']);
  });
});
