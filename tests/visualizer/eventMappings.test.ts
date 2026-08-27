import { describe, expect, it } from 'vitest';
import { mapSseEnvelope } from '../../src/components/visualizer/state/eventMappings';

describe('SSE event mapping', () => {
  it('maps scheduler.job_started to JOB_STARTED with target slug from data.to', () => {
    const actions = mapSseEnvelope({
      type: 'scheduler.job_started',
      data: { job_id: 'j1', job_name: 'repair', job_type: 'chain', to: 'litellm' },
      ts: '2026-08-27T00:00:00.000Z',
    });
    expect(actions[0]).toEqual({
      type: 'JOB_STARTED',
      jobId: 'j1',
      jobName: 'repair',
      jobType: 'chain',
      to: 'litellm',
    });
  });

  it('maps scheduler.job_completed with target resolved from payload.to', () => {
    const actions = mapSseEnvelope({
      type: 'scheduler.job_completed',
      data: { job_id: 'j2', job_name: 'kairos_scan', job_type: 'chain', to: 'draymond' },
      ts: '2026-08-27T00:00:00.000Z',
    });
    expect(actions[0].type).toBe('JOB_COMPLETED');
    expect(actions[0]).toMatchObject({ jobId: 'j2', jobName: 'kairos_scan' });
  });

  it('maps scheduler.job_failed to JOB_FAILED', () => {
    const actions = mapSseEnvelope({
      type: 'scheduler.job_failed',
      data: { job_id: 'j3', job_name: 'repair_failed_jobs', job_type: 'chain', to: 'claw-protect' },
      ts: '2026-08-27T00:00:00.000Z',
    });
    expect(actions[0].type).toBe('JOB_FAILED');
  });

  it('returns empty array for unknown types', () => {
    expect(mapSseEnvelope({ type: 'agent.heartbeat', data: {}, ts: 'x' })).toEqual([]);
  });

  it('derives a target slug from job name when no to field present', () => {
    const actions = mapSseEnvelope({
      type: 'scheduler.job_completed',
      data: { job_id: 'j4', job_name: 'litellm_rotation', job_type: 'custom' },
      ts: '2026-08-27T00:00:00.000Z',
    });
    expect(actions[0]).toMatchObject({ to: 'litellm' });
  });
});