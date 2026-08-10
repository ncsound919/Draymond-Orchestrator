import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { submitExperiment, getExperimentsMap, type TaskInput } from '@/lib/biotech/api';
import { POST as runPost } from '@/app/api/v1/biotech/run/route';
import { GET as experimentsGet } from '@/app/api/v1/biotech/experiments/route';
import type { Task } from '@/lib/biotech/types';

const { mockStore, mockPython } = vi.hoisted(() => ({
  mockStore: {
    saveExperiment: vi.fn().mockResolvedValue(undefined),
    getExperimentsMap: vi.fn().mockResolvedValue({ 'exp-1': { status: 'running' } }),
  },
  mockPython: {
    runPythonAnalysis: vi
      .fn()
      .mockResolvedValue({ success: true, data: { data: [{ ter: 30, risk_tier: 'HIGH' }] }, error: null, evidence_tier: 'E1' }),
    runPythonTreatment: vi
      .fn()
      .mockResolvedValue({ success: true, data: { data: [{ recommendation: 'neoadjuvant chemo' }] }, error: null, evidence_tier: 'E1' }),
    runPythonTranslate: vi
      .fn()
      .mockResolvedValue({ success: true, data: { data: [{ target_term: 'Transfection Efficiency' }] }, error: null, evidence_tier: 'E3' }),
  },
}));

vi.mock('@/lib/biotech/store', () => mockStore);
vi.mock('@/lib/biotech/pythonExecutors', () => mockPython);

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
  return makeRequest('http://localhost/api/v1/biotech/run', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

const tasks: Task[] = [
  { id: 't1', engine: 'onco_stat_crew', inputs: { dataset: 'x' }, depends_on: [], is_gate: false, status: 'pending', evidence: { tier: 'E1', lineageParentIds: [] } },
  { id: 't2', engine: 'onco_coach', inputs: {}, depends_on: ['t1'], is_gate: false, status: 'pending', evidence: { tier: 'E1', lineageParentIds: [] } },
];

describe('biotech api', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    mockStore.saveExperiment.mockClear();
    mockStore.getExperimentsMap.mockClear();
    mockStore.getExperimentsMap.mockResolvedValue({ 'exp-1': { status: 'running' } });
    mockPython.runPythonAnalysis.mockClear();
    mockPython.runPythonTreatment.mockClear();
    mockPython.runPythonTranslate.mockClear();
  });

  it('submits a run and returns experiment_id + task_count', async () => {
    const res = await submitExperiment({ cancer_type: 'breast', goal: 'assess recurrence risk', tasks });
    expect(res.experiment_id).toBeTruthy();
    expect(res.task_count).toBe(2);
  });

  it('persists a running row at submission', async () => {
    const res = await submitExperiment({ cancer_type: 'breast', goal: 'assess recurrence risk', tasks });
    expect(mockStore.saveExperiment).toHaveBeenCalledWith(
      expect.objectContaining({ experiment_id: res.experiment_id, status: 'running' }),
    );
  });

  it('threads cancer_type into task inputs and settles to a terminal state', async () => {
    await submitExperiment({ cancer_type: 'breast', goal: 'assess recurrence risk', tasks });
    expect(mockPython.runPythonAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ dataset: 'x', cancer_type: 'breast' }),
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

  it('passes the validation gate for well-formed executor output (no warn on success)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await submitExperiment({ cancer_type: 'breast', goal: 'assess recurrence risk', tasks });
      await vi.waitFor(() => {
        expect(mockStore.saveExperiment.mock.calls.at(-1)?.[0]).toMatchObject({
          status: 'completed',
        });
      });
      expect(warnSpy).not.toHaveBeenCalledWith(
        '[biotech] experiment result failed validation',
        expect.anything(),
        expect.anything(),
        expect.arrayContaining([expect.any(String)]),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('warns (non-blocking) when executor output fails the validation gate', async () => {
    mockPython.runPythonAnalysis.mockResolvedValueOnce({
      success: true,
      data: { ter: 30 },
      error: null,
      evidence_tier: 'E1',
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await submitExperiment({ cancer_type: 'breast', goal: 'assess recurrence risk', tasks });
      await vi.waitFor(() => {
        expect(mockStore.saveExperiment.mock.calls.at(-1)?.[0]).toMatchObject({
          status: 'completed',
        });
      });
      expect(warnSpy).toHaveBeenCalledWith(
        '[biotech] experiment result failed validation',
        expect.anything(),
        expect.anything(),
        expect.arrayContaining([expect.any(String)]),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('unwraps wrapped upstream metrics before handing them to the treatment executor', async () => {
    await submitExperiment({ cancer_type: 'breast', goal: 'assess recurrence risk', tasks });
    await vi.waitFor(() => {
      expect(mockPython.runPythonTreatment).toHaveBeenCalledWith(
        expect.objectContaining({ risk_tier: 'HIGH', ter: 30 }),
      );
    });
  });

  it('accepts a BlackMind adapter-shaped task payload and resolves engine from agent', async () => {
    const adapterTasks: TaskInput[] = [
      { id: 't1', agent: 'onco_stat_crew', inputs: {}, depends_on: [] },
      { id: 't2', agent: 'onco_coach', inputs: {}, depends_on: ['t1'] },
    ];
    const res = await submitExperiment({ cancer_type: 'breast', goal: 'assess recurrence risk', tasks: adapterTasks });
    expect(res.experiment_id).toBeTruthy();
    expect(res.task_count).toBe(2);
    await vi.waitFor(() => {
      expect(mockStore.saveExperiment.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'completed' });
    });
    expect(mockPython.runPythonAnalysis).toHaveBeenCalled();
    expect(mockPython.runPythonTreatment).toHaveBeenCalledWith(
      expect.objectContaining({ risk_tier: 'HIGH', ter: 30 }),
    );
  });

  it('dispatches a translation task to the translate executor', async () => {
    const transTasks: Task[] = [
      {
        id: 't1',
        engine: 'translation',
        inputs: { term: 'FG_PCT', value: 45.5 },
        depends_on: [],
        is_gate: false,
        status: 'pending',
        evidence: { tier: 'E1', lineageParentIds: [] },
      },
    ];
    await submitExperiment({ cancer_type: 'breast', goal: 'translate metric', tasks: transTasks });
    await vi.waitFor(() => {
      expect(mockStore.saveExperiment.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'completed' });
    });
    expect(mockPython.runPythonTranslate).toHaveBeenCalledWith('FG_PCT', 45.5, true);
  });

  it('persists success:true on completed task results', async () => {
    await submitExperiment({ cancer_type: 'breast', goal: 'assess recurrence risk', tasks });
    await vi.waitFor(() => {
      expect(mockStore.saveExperiment.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'completed' });
    });
    const terminal = mockStore.saveExperiment.mock.calls.at(-1)?.[0] as {
      tasks: Array<{ status: string; result?: { success?: boolean } }>;
    };
    expect(terminal.tasks).toHaveLength(2);
    for (const t of terminal.tasks) {
      expect(t.status).toBe('done');
      expect(t.result?.success).toBe(true);
    }
  });
});

describe('biotech routes', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    mockStore.saveExperiment.mockClear();
    mockStore.getExperimentsMap.mockClear();
    mockStore.getExperimentsMap.mockResolvedValue({ 'exp-1': { status: 'running' } });
    mockPython.runPythonAnalysis.mockClear();
    mockPython.runPythonTreatment.mockClear();
    mockPython.runPythonTranslate.mockClear();
  });

  it('rejects unauthenticated requests', async () => {
    const unauthorized = await experimentsGet(
      makeRequest('http://localhost/api/v1/biotech/experiments', { headers: {} }),
    );
    expect(unauthorized.status).toBe(401);

    const wrongToken = await experimentsGet(
      makeRequest('http://localhost/api/v1/biotech/experiments', {
        headers: { Authorization: 'Bearer wrong-secret' },
      }),
    );
    expect(wrongToken.status).toBe(401);
  });

  it('returns 400 when cancer_type, goal or tasks are missing', async () => {
    const res = await runPost(runReq({ goal: 'win' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe('cancer_type, goal and tasks required');
  });

  it('returns 400 on a malformed JSON body', async () => {
    const res = await runPost(
      makeRequest('http://localhost/api/v1/biotech/run', {
        method: 'POST',
        headers: authHeaders(),
        body: '{ not valid json',
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });

  it('submits a run through the route with the ok envelope', async () => {
    const res = await runPost(runReq({ cancer_type: 'breast', goal: 'assess recurrence risk', tasks }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.task_count).toBe(2);
    expect(data.experiment_id).toBeTruthy();
  });

  it('returns a 500 ok:false shape when the store fails', async () => {
    mockStore.getExperimentsMap.mockRejectedValueOnce(new Error('boom'));
    const res = await experimentsGet(
      makeRequest('http://localhost/api/v1/biotech/experiments', { headers: authHeaders() }),
    );
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBeTruthy();
  });
});
