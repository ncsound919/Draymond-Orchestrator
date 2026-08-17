import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { mockCallLLM, mockCallLocalModel } = vi.hoisted(() => ({
  mockCallLLM: vi.fn(),
  mockCallLocalModel: vi.fn(async (): Promise<string> => {
    throw new Error('local model not configured');
  }),
}));

vi.mock('@/lib/draymond/llm', () => ({
  callLLM: mockCallLLM,
  callLocalModel: mockCallLocalModel,
}));
vi.mock('@/lib/audit', () => ({
  appendAuditLog: vi.fn(async () => {}),
}));

import { POST } from '@/app/api/swarm/decompose/route';

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret';
  mockCallLLM.mockReset();
  mockCallLocalModel.mockReset();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/swarm/decompose', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-secret',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function validDecomposition() {
  return JSON.stringify({
    tasks: [
      { id: 'task-1', description: 'Build landing page', agent: 'megacode', priority: 'high', context: {} },
    ],
    recommended_mode: 'parallel',
    reasoning: 'Straightforward build task.',
  });
}

describe('POST /api/swarm/decompose', () => {
  it('accepts a valid decomposition from the local model without hitting the paid LLM', async () => {
    mockCallLocalModel.mockResolvedValueOnce(validDecomposition());

    const res = await POST(makeRequest({ goal: 'Ship a landing page' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].agent).toBe('megacode');
    expect(mockCallLocalModel).toHaveBeenCalledTimes(1);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('falls back to the paid LLM when the local model returns invalid JSON', async () => {
    mockCallLocalModel.mockResolvedValueOnce('not-json');
    mockCallLLM.mockResolvedValueOnce(validDecomposition());

    const res = await POST(makeRequest({ goal: 'Ship a landing page' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tasks).toHaveLength(1);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
  });

  it('falls back to the paid LLM when the local model returns an empty tasks array', async () => {
    mockCallLocalModel.mockResolvedValueOnce(
      JSON.stringify({ tasks: [], recommended_mode: 'parallel', reasoning: 'none' }),
    );
    mockCallLLM.mockResolvedValueOnce(validDecomposition());

    const res = await POST(makeRequest({ goal: 'Ship a landing page' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tasks).toHaveLength(1);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when the goal is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockCallLocalModel).not.toHaveBeenCalled();
    expect(mockCallLLM).not.toHaveBeenCalled();
  });
});
