import { NextRequest, NextResponse } from 'next/server';
import { appendAuditLog } from '@/lib/audit';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

const VALID_AGENTS = new Set([
  'megacode', 'uplift', 'rex', 'maya', 'finn', 'cleo', 'lexa',
]);
const VALID_MODES = new Set(['parallel', 'sequential']);
const MAX_TASKS = 50;
const MAX_DESCRIPTION_LEN = 2000;
const MAX_GOAL_LEN = 500;
const UPLIFT_TIMEOUT_MS = 30_000;

export interface SwarmTask {
  id: string;
  description: string;
  agent: string;
  context?: Record<string, unknown>;
  priority?: 'high' | 'normal' | 'low';
}

const UPLIFT_BASE_URL = process.env.UPLIFT_BASE_URL ?? 'http://localhost:8000';

function validateTask(task: unknown, idx: number): SwarmTask {
  if (!task || typeof task !== 'object')
    throw new Error(`tasks[${idx}] must be an object`);
  const t = task as Record<string, unknown>;
  if (!t.id || typeof t.id !== 'string' || !t.id.trim())
    throw new Error(`tasks[${idx}].id is required`);
  if (!t.description || typeof t.description !== 'string')
    throw new Error(`tasks[${idx}].description is required`);
  if ((t.description as string).length > MAX_DESCRIPTION_LEN)
    throw new Error(`tasks[${idx}].description exceeds ${MAX_DESCRIPTION_LEN} chars`);
  if (!t.agent || !VALID_AGENTS.has(t.agent as string))
    throw new Error(
      `tasks[${idx}].agent "${t.agent}" is not valid. Allowed: ${[...VALID_AGENTS].join(', ')}`,
    );
  return {
    id: (t.id as string).trim().slice(0, 128),
    description: t.description as string,
    agent: t.agent as string,
    context:
      t.context && typeof t.context === 'object' && !Array.isArray(t.context)
        ? (t.context as Record<string, unknown>)
        : {},
    priority: ['high', 'normal', 'low'].includes(t.priority as string)
      ? (t.priority as SwarmTask['priority'])
      : 'normal',
  };
}

async function dispatchToUplift(
  task: SwarmTask,
  sessionId: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLIFT_TIMEOUT_MS);
  try {
    const response = await fetch(`${UPLIFT_BASE_URL}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: task.id,
        description: task.description,
        agent: task.agent,
        context: task.context ?? {},
        session_id: sessionId,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Never forward Uplift internals to the caller
      throw new Error(`Uplift returned ${response.status} for task ${task.id}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const bodyResult = await parseJsonBody(request);
    if (bodyResult.error) return bodyResult.error;
    const body = bodyResult.data as Record<string, unknown>;

    // --- Input validation ---
    const goal =
      typeof body?.goal === 'string' ? body.goal.trim() : '';
    if (!goal)
      return NextResponse.json({ error: 'goal is required' }, { status: 400 });
    if (goal.length > MAX_GOAL_LEN)
      return NextResponse.json(
        { error: `goal exceeds ${MAX_GOAL_LEN} characters` },
        { status: 400 },
      );

    const rawTasks: unknown = body?.tasks;
    if (!Array.isArray(rawTasks) || rawTasks.length === 0)
      return NextResponse.json(
        { error: 'tasks must be a non-empty array' },
        { status: 400 },
      );
    if (rawTasks.length > MAX_TASKS)
      return NextResponse.json(
        { error: `Cannot dispatch more than ${MAX_TASKS} tasks at once` },
        { status: 400 },
      );

    const mode = typeof body?.mode === 'string' ? body.mode : '';
    if (!VALID_MODES.has(mode))
      return NextResponse.json(
        { error: `mode must be one of: ${[...VALID_MODES].join(', ')}` },
        { status: 400 },
      );

    // Validate all tasks before dispatching any (fail-fast)
    let validatedTasks: SwarmTask[];
    try {
      validatedTasks = rawTasks.map(validateTask);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Invalid task' },
        { status: 400 },
      );
    }

    const sessionId =
      typeof body?.session_id === 'string' && body.session_id.trim()
        ? body.session_id.trim().slice(0, 128)
        : `swarm-${Date.now()}`;

    await appendAuditLog({
      event: 'swarm_dispatch_start',
      session_id: sessionId,
      goal,
      task_count: validatedTasks.length,
      mode,
      agent: 'draymond',
    });

    // --- Dispatch ---
    let rawResults: PromiseSettledResult<unknown>[];
    if (mode === 'parallel') {
      rawResults = await Promise.allSettled(
        validatedTasks.map((t) => dispatchToUplift(t, sessionId)),
      );
    } else {
      const settled: PromiseSettledResult<unknown>[] = [];
      for (const task of validatedTasks) {
        try {
          const value = await dispatchToUplift(task, sessionId);
          settled.push({ status: 'fulfilled', value });
        } catch (reason) {
          settled.push({
            status: 'rejected',
            reason: reason instanceof Error ? reason.message : String(reason),
          });
        }
      }
      rawResults = settled;
    }

    // Sanitise results — never leak raw rejection objects to the caller
    const results = rawResults.map((r, i) =>
      r.status === 'fulfilled'
        ? { task_id: validatedTasks[i].id, status: 'queued', data: r.value }
        : {
            task_id: validatedTasks[i].id,
            status: 'failed',
            error:
              r.reason instanceof Error
                ? r.reason.message
                : String((r as PromiseRejectedResult).reason),
          },
    );

    await appendAuditLog({
      event: 'swarm_dispatch_complete',
      session_id: sessionId,
      goal,
      results_count: results.length,
      failed_count: results.filter((r) => r.status === 'failed').length,
      agent: 'draymond',
    });

    return NextResponse.json({ session_id: sessionId, goal, results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Swarm dispatch failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  return NextResponse.json({
    status: 'Draymond Swarm Dispatcher ready',
    modes: [...VALID_MODES],
    agents: [...VALID_AGENTS],
    max_tasks: MAX_TASKS,
  });
}
