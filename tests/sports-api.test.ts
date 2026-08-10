import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { submitExperiment, getExperimentsMap } from '@/lib/sports/api';
import { POST as runPost } from '@/app/api/v1/sports/run/route';
import { GET as experimentsGet } from '@/app/api/v1/sports/experiments/route';
import type { Task } from '@/lib/sports/types';

const { mockStore, mockPython } = vi.hoisted(() => ({
  mockStore: {
    saveExperiment: vi.fn().mockResolvedValue(undefined),
    getExperimentsMap: vi.fn().mockResolvedValue({ 'exp-1': { status: 'running' } }),
  },
  mockPython: {
    runPythonMetrics: vi
      .fn()
      .mockResolvedValue({ success: true, data: { data: [{ ter: 30, injury_risk: 40 }] }, error: null, evidence_tier: 'E1' }),
    runPythonCoach: vi
      .fn()
      .mockResolvedValue({ success: true, data: { data: [{ recovery: 'standard rotation; progressive overload' }] }, error: null, evidence_tier: 'E1' }),
    runPythonTranslate: vi
      .fn()
      .mockResolvedValue({ success: true, data: { data: [{ target_term: 'Transfection Efficiency' }] }, error: null, evidence_tier: 'E3' }),
    runPythonInsights: vi
      .fn()
      .mockResolvedValue({ success: true, data: { data: [{ target_read: 'tumor implication' }] }, error: null, evidence_tier: 'E3' }),
  },
}));

vi.mock('@/lib/sports/store', () => mockStore);
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

function runReq(body: unknown): NextRequest {
  return makeRequest('http://localhost/api/v1/sports/run', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

const tasks: Task[] = [
  { id: 't1', engine: 'stat_crew', inputs: { dataset: 'x' }, depends_on: [], is_gate: false, status: 'pending', evidence: { tier: 'E1', lineageParentIds: [] } },
  { id: 't2', engine: 'coach', inputs: {}, depends_on: ['t1'], is_gate: false, status: 'pending', evidence: { tier: 'E1', lineageParentIds: [] } },
];

describe('sports api', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    mockStore.saveExperiment.mockClear();
    mockStore.getExperimentsMap.mockClear();
    mockStore.getExperimentsMap.mockResolvedValue({ 'exp-1': { status: 'running' } });
    mockPython.runPythonMetrics.mockClear();
    mockPython.runPythonCoach.mockClear();
  });

  it('submits a run and returns experiment_id + task_count', async () => {
    const res = await submitExperiment({ sport: 'basketball', goal: 'assess form', tasks });
    expect(res.experiment_id).toBeTruthy();
    expect(res.task_count).toBe(2);
  });

  it('persists a running row at submission', async () => {
    const res = await submitExperiment({ sport: 'basketball', goal: 'assess form', tasks });
    expect(mockStore.saveExperiment).toHaveBeenCalledWith(
      expect.objectContaining({ experiment_id: res.experiment_id, status: 'running' }),
    );
  });

  it('threads sport into task inputs and settles to a terminal state', async () => {
    await submitExperiment({ sport: 'basketball', goal: 'assess form', tasks });
    expect(mockPython.runPythonMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ dataset: 'x', sport: 'basketball' }),
    );
    await vi.waitFor(() => {
      expect(mockStore.saveExperiment.mock.calls.at(-1)?.[0]).toMatchObject({
        status: 'completed',
      });
    });
  });

  it('lists experiments keyed by id', async () => {
    const map = await getExperimentsMap();
    expect(map).toEqual({ 'exp-1': { status: 'running' } });
  });

  it('rejects a run request missing sport/goal/tasks', async () => {
    const res = await runPost(runReq({ sport: 'basketball' }));
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain('sport, goal and tasks required');
  });

  it('returns experiments from the GET route', async () => {
    const res = await experimentsGet(makeRequest('http://localhost/api/v1/sports/experiments', { method: 'GET', headers: authHeaders() }));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json['exp-1'].status).toBe('running');
  });
});
