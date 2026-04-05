const UPLIFT_BASE_URL = process.env.UPLIFT_BASE_URL || 'http://localhost:8000';

/** Build common headers for Uplift requests, including auth if configured. */
function upliftHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = process.env.UPLIFT_API_KEY;
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

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
    const res = await fetch(`${UPLIFT_BASE_URL}/health`, {
      headers: upliftHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function dispatchTask(
  task: UpliftTaskRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`${UPLIFT_BASE_URL}/task`, {
    method: 'POST',
    headers: upliftHeaders(),
    body: JSON.stringify(task),
    signal: signal ?? AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    // Truncate body to avoid leaking internal Uplift details
    const body = await response.text().catch(() => '');
    throw new Error(
      `Uplift task dispatch failed [${response.status}]: ${body.slice(0, 120)}`,
    );
  }

  return response.json();
}

export async function dispatchBatch(
  request: UpliftBatchRequest,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const response = await fetch(`${UPLIFT_BASE_URL}/batch/multi`, {
    method: 'POST',
    headers: upliftHeaders(),
    body: JSON.stringify(request),
    signal: signal ?? AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Uplift batch dispatch failed [${response.status}]: ${body.slice(0, 120)}`,
    );
  }

  return response.json();
}

export async function getTaskStatus(taskId: string): Promise<unknown> {
  const response = await fetch(`${UPLIFT_BASE_URL}/task/${encodeURIComponent(taskId)}`, {
    headers: upliftHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Failed to get task status for ${taskId}`);
  }
  return response.json();
}

export async function getSessionStatus(sessionId: string): Promise<unknown> {
  const response = await fetch(
    `${UPLIFT_BASE_URL}/session/${encodeURIComponent(sessionId)}`,
    {
      headers: upliftHeaders(),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to get session status for ${sessionId}`);
  }
  return response.json();
}
