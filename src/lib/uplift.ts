const UPLIFT_BASE_URL = process.env.UPLIFT_BASE_URL || 'http://localhost:8000';

export interface UpliftTaskRequest {
  task_id: string;
  description: string;
  agent: string;
  context?: Record<string, unknown>;
  session_id: string;
}

export interface UpliftBatchRequest {
  tasks: UpliftTaskRequest[];
  mode: 'parallel' | 'sequential';
  session_id: string;
}

export async function pingUplift(): Promise<boolean> {
  try {
    const res = await fetch(`${UPLIFT_BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function dispatchTask(task: UpliftTaskRequest): Promise<unknown> {
  const response = await fetch(`${UPLIFT_BASE_URL}/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Uplift task dispatch failed [${response.status}]: ${body}`);
  }

  return response.json();
}

export async function dispatchBatch(request: UpliftBatchRequest): Promise<unknown[]> {
  const response = await fetch(`${UPLIFT_BASE_URL}/batch/multi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Uplift batch dispatch failed [${response.status}]: ${body}`);
  }

  return response.json();
}

export async function getTaskStatus(taskId: string): Promise<unknown> {
  const response = await fetch(`${UPLIFT_BASE_URL}/task/${taskId}`);
  if (!response.ok) {
    throw new Error(`Failed to get task status for ${taskId}`);
  }
  return response.json();
}

export async function getSessionStatus(sessionId: string): Promise<unknown> {
  const response = await fetch(`${UPLIFT_BASE_URL}/session/${sessionId}`);
  if (!response.ok) {
    throw new Error(`Failed to get session status for ${sessionId}`);
  }
  return response.json();
}
