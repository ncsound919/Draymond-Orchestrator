// ============================================================================
// DRAYMOND BIOTECH ENGINE — TaskDAG execution engine
// ============================================================================
// Topological ordering + concurrent-safe DAG execution with evidence tracking
// and human gate support. Mirrors the sports engine's dag gate contract.
//
// runDag returns { promise } so the caller can fire-and-forget while the DAG
// settles in the background (see api.ts submitExperiment).
// ============================================================================

import type { ExperimentStatus } from './types';
import type { Task, TaskDAG } from './types';
import type { PythonResult, WrappedOutput } from './pythonExecutors';

export type Executor = (
  task: Task,
  upstream: Map<string, WrappedOutput>,
) => Promise<PythonResult>;

export interface DagRun {
  promise: Promise<ExperimentStatus>;
}

/** Topologically sort tasks by depends_on (Kahn's algorithm). Throws on cycles. */
export function topoOrder(tasks: Task[]): string[] {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of tasks) {
    indegree.set(t.id, 0);
    adj.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (!indegree.has(dep)) {
        throw new Error(`task ${t.id} depends on unknown task ${dep}`);
      }
      indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
      adj.get(dep)?.push(t.id);
    }
  }
  const ready: string[] = [];
  for (const [id, d] of indegree) {
    if (d === 0) ready.push(id);
  }
  const order: string[] = [];
  while (ready.length > 0) {
    // Stable: process in the order tasks were declared (FIFO queue).
    const id = ready.shift() as string;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, d);
      if (d === 0) ready.push(next);
    }
  }
  if (order.length !== tasks.length) {
    throw new Error('task graph contains a cycle or dangling dependency');
  }
  return order;
}

/**
 * Execute a TaskDAG. Runs ready tasks per round (respecting dependencies),
 * collects upstream results keyed by task id, and honors is_gate by waiting
 * for an explicit release (the fire-and-forget path auto-releases gates).
 */
export function runDag(dag: TaskDAG, executor: Executor, opts?: { autoApproveGates?: boolean }): DagRun {
  const autoApprove = opts?.autoApproveGates ?? true;
  const promise = executeDag(dag, executor, autoApprove);
  return { promise };
}

async function executeDag(dag: TaskDAG, executor: Executor, autoApprove: boolean): Promise<ExperimentStatus> {
  const status: ExperimentStatus = {
    experiment_id: dag.experiment_id,
    status: 'running',
    tasks: dag.tasks.map((t) => ({ ...t })),
    goal: dag.goal,
    created_at: dag.created_at,
    updated_at: new Date().toISOString(),
  };
  const byId = new Map(status.tasks.map((t) => [t.id, t]));
  const upstream = new Map<string, WrappedOutput>();
  const remaining = new Set(status.tasks.map((t) => t.id));

  while (remaining.size > 0) {
    // Round: all tasks whose dependencies have completed.
    const round: Task[] = [];
    for (const id of [...remaining]) {
      const t = byId.get(id);
      if (!t) continue;
      const depsDone = t.depends_on.every((d) => !remaining.has(d) && upstream.has(d));
      if (depsDone) round.push(t);
    }
    if (round.length === 0) {
      // No progress possible → deadlock (should not happen after topoOrder).
      for (const id of remaining) {
        const t = byId.get(id);
        if (t) t.status = 'failed';
        if (t) t.error = 'deadlock: dependencies never satisfied';
      }
      break;
    }

    await Promise.all(
      round.map(async (task) => {
        task.status = 'running';
        if (task.is_gate && !autoApprove) {
          task.status = 'awaiting_human';
          return; // gate blocks this round; re-check next round
        }
        try {
          const result = await executor(task, upstream);
          task.result = result;
          task.evidence = {
            tier: result.evidence_tier ?? task.evidence.tier,
            lineageParentIds: task.depends_on,
          };
          task.status = result.success ? 'done' : 'failed';
          if (!result.success) task.error = result.error ?? 'execution failed';
          // Upstream stores the WrappedOutput (result.data), matching how
          // api.ts unwraps metrics (upstream.values() -> unwrapMetrics expects
          // the { data: [...] } payload).
          upstream.set(task.id, result.data);
        } catch (err) {
          task.status = 'failed';
          task.error = err instanceof Error ? err.message : String(err);
        }
      }),
    );

    // Remove completed/failed tasks from remaining (keep awaiting_human).
    for (const task of round) {
      if (task.status === 'done' || task.status === 'failed') {
        remaining.delete(task.id);
      }
    }
  }

  const allDone = status.tasks.every((t) => t.status === 'done');
  status.status = allDone ? 'completed' : status.tasks.some((t) => t.status === 'failed') ? 'failed' : 'awaiting_human';
  status.updated_at = new Date().toISOString();
  return status;
}
