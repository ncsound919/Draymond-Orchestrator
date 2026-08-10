import type { EvidenceTier, ExperimentStatus, Task, TaskDAG } from './types';
import { hashPayload } from './evidence';

export type Executor = (task: Task, upstream: Map<string, unknown>) => Promise<{
  success: boolean;
  data: unknown;
  error: string | null;
  evidence_tier: string;
}>;

export function topoOrder(tasks: Task[]): string[] {
  const done = new Set<string>();
  const order: string[] = [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visit = (id: string, trail: Set<string>) => {
    if (done.has(id)) return;
    if (trail.has(id)) throw new Error(`cycle at ${id}`);
    const task = byId.get(id);
    if (!task) throw new Error(`unknown task ${id}`);
    trail.add(id);
    for (const dep of task.depends_on) visit(dep, trail);
    trail.delete(id);
    done.add(id);
    order.push(id);
  };
  for (const t of tasks) visit(t.id, new Set());
  return order;
}

function waitersFor(task: Task, tasks: Task[]): string[] {
  return tasks.filter((t) => t.depends_on.includes(task.id)).map((t) => t.id);
}

export type DagRun = Promise<ExperimentStatus> & {
  promise: Promise<ExperimentStatus>;
  approve: (taskId: string) => void;
  abort: (taskId: string) => void;
};

export function runDag(
  dag: TaskDAG,
  executor: Executor,
): DagRun {
  // Validate up front so malformed input throws instead of hanging: topoOrder
  // throws on cycles ("cycle at X") and unknown dependency ids ("unknown task X").
  // An experiment with no tasks is a caller bug, so reject it explicitly rather
  // than silently resolving to the vacuous 'completed' status.
  if (dag.tasks.length === 0) throw new Error('experiment has no tasks');
  topoOrder(dag.tasks);
  const tasks = dag.tasks.map((t) => ({ ...t }));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const upstream = new Map<string, unknown>();
  const waiters = new Map<string, string[]>(tasks.map((t) => [t.id, waitersFor(t, tasks)]));
  const approvers = new Map<string, () => void>();
  const aborters = new Map<string, () => void>();
  let resolveStatus!: (s: ExperimentStatus) => void;

  const statusOf = (): ExperimentStatus => ({
    experiment_id: dag.experiment_id,
    status: tasks.every((t) => t.status === 'done')
      ? 'completed'
      : tasks.some((t) => t.status === 'failed')
        ? 'failed'
        : tasks.some((t) => t.status === 'awaiting_human')
          ? 'awaiting_human'
          : 'running',
    tasks,
    created_at: dag.created_at,
    updated_at: new Date().toISOString(),
  });

  const finishIfDone = () => {
    if (tasks.every((t) => t.status === 'done' || t.status === 'failed')) {
      resolveStatus(statusOf());
    }
  };

  const markFailedDownstream = (taskId: string, reason: string) => {
    for (const w of waiters.get(taskId) ?? []) {
      const waiter = byId.get(w);
      if (waiter && waiter.status === 'pending') {
        waiter.status = 'failed';
        waiter.error = reason;
        markFailedDownstream(w, reason);
      }
    }
  };

  const dispatchAfter = (task: Task) => {
    if (task.status === 'failed') {
      markFailedDownstream(task.id, task.error ?? 'skipped: upstream task failed');
    } else {
      for (const w of waiters.get(task.id) ?? []) {
        const waiter = byId.get(w);
        if (waiter && waiter.status === 'pending' && waiter.depends_on.every((d) => byId.get(d)?.status === 'done')) {
          void runTask(waiter);
        }
      }
    }
    finishIfDone();
  };

  // Spread-target guard: executors always return object data, but a primitive
  // or null must not turn the stamped result into a string/char-indexed object.
  const asRecord = (data: unknown): Record<string, unknown> => {
    if (typeof data === 'object' && data !== null) return data as Record<string, unknown>;
    return {};
  };

  // Wire the evidence envelope into the runtime path: after a task reaches a
  // terminal state ('done' or 'failed') stamp a sha256 payload hash over its
  // engine/inputs/result/lineage and set lineage from depends_on when no
  // lineage was supplied up front. The persisted DAG then carries per-task
  // payload_hash + lineage — the hash-chained ledger — without a schema change.
  const stampEvidence = (task: Task) => {
    task.evidence.payloadHash = hashPayload({
      engine: task.engine,
      inputs: task.inputs,
      result: task.result,
      lineageParentIds: task.depends_on,
    });
    if (task.evidence.lineageParentIds.length === 0) {
      task.evidence.lineageParentIds = [...task.depends_on];
    }
  };

  const runTask = async (task: Task) => {
    task.status = 'running';
    if (task.is_gate) {
      task.status = 'awaiting_human';
      await new Promise<void>((resolve) => {
        approvers.set(task.id, () => { task.status = 'done'; resolve(); });
        aborters.set(task.id, () => { task.status = 'failed'; task.error = 'aborted at gate'; resolve(); });
      });
      stampEvidence(task);
      dispatchAfter(task);
      return;
    }
    try {
      const result = await executor(task, upstream);
      if (!result.success) {
        task.status = 'failed';
        task.error = result.error ?? undefined;
        // Stamp the outcome on the persisted result so the BlackMind adapter's
        // `t.status === 'done' && t.result?.success === true` E1 classification
        // is satisfiable on the terminal experiment row.
        task.result = { ...asRecord(result.data), success: false };
      } else {
        task.status = 'done';
        task.evidence.tier = (result.evidence_tier as EvidenceTier) ?? task.evidence.tier;
        task.result = { ...asRecord(result.data), success: true };
      }
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);
    }
    stampEvidence(task);
    upstream.set(task.id, task.result);
    dispatchAfter(task);
  };

  const promise = new Promise<ExperimentStatus>((res) => { resolveStatus = res; });

  // launch roots
  const roots = tasks.filter((t) => t.depends_on.length === 0);
  for (const root of roots) void runTask(root);

  return Object.assign(promise, {
    promise,
    approve: (taskId: string) => approvers.get(taskId)?.(),
    abort: (taskId: string) => aborters.get(taskId)?.(),
  });
}
