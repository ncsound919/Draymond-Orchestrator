import { describe, expect, it } from 'vitest';
import { initialState, simReducer } from '../../src/components/visualizer/state/reducer';
import type { SnapshotPayload } from '../../src/components/visualizer/state/types';

const snap: SnapshotPayload = {
  services: [
    { slug: 'litellm', name: 'LiteLLM', category: 'coding', port: 4100, up: true },
    { slug: 'claw-protect', name: 'Claw-Protect', category: 'security', port: 3300, up: true },
  ],
  agents: [{ slug: 'grader', name: 'Grader', up: true }],
  jobs: [],
  moments: [],
  revenueUsd: 42.5,
  degraded: false,
  servicesUp: 2,
  servicesTotal: 2,
  checkedAt: '2026-08-27T00:00:00.000Z',
};

describe('sim reducer', () => {
  it('applies a snapshot into buildings/radar/alerts', () => {
    const next = simReducer(initialState(), { type: 'APPLY_SNAPSHOT', payload: snap });
    expect(Object.keys(next.buildings)).toContain('litellm');
    expect(Object.keys(next.buildings)).toContain('agent:grader');
    expect(next.revenueUsd).toBe(42.5);
    expect(next.servicesUp).toBe(2);
  });

  it('turns a job_started event into a transit vehicle and log entry', () => {
    let s = simReducer(initialState(), { type: 'APPLY_SNAPSHOT', payload: snap });
    s = simReducer(s, {
      type: 'JOB_STARTED',
      jobId: 'j1', jobName: 'benchmark-rotation', jobType: 'chain',
      to: 'litellm',
    });
    const vehicle = Object.values(s.vehicles).find((v) => v.jobName === 'benchmark-rotation');
    expect(vehicle).toBeDefined();
    expect(vehicle?.status).toBe('transit');
    expect(s.ticker[0].kind).toBe('info');
  });

  it('marks a vehicle arrived on completion and adds a success log', () => {
    let s = simReducer(initialState(), { type: 'APPLY_SNAPSHOT', payload: snap });
    s = simReducer(s, { type: 'JOB_STARTED', jobId: 'j1', jobName: 'x', jobType: 'chain', to: 'litellm' });
    s = simReducer(s, { type: 'JOB_COMPLETED', jobId: 'j1', jobName: 'x', jobType: 'chain', to: 'litellm' });
    const vehicle = Object.values(s.vehicles).find((v) => v.id === 'j1');
    expect(vehicle?.status).toBe('arrived');
    expect(s.ticker[0].kind).toBe('success');
  });

  it('turns a job failure into a smoke effect and a fail log', () => {
    let s = simReducer(initialState(), { type: 'APPLY_SNAPSHOT', payload: snap });
    s = simReducer(s, { type: 'JOB_FAILED', jobId: 'j2', jobName: 'y', jobType: 'chain', to: 'claw-protect' });
    expect(Object.values(s.effects).some((e) => e.kind === 'smoke' && e.slug === 'claw-protect')).toBe(true);
    expect(s.ticker[0].kind).toBe('fail');
  });

  it('toggles degraded mode from snapshot', () => {
    const s = simReducer(initialState(), { type: 'APPLY_SNAPSHOT', payload: { ...snap, degraded: true } });
    expect(s.degraded).toBe(true);
  });
});