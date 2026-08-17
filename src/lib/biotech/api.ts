import { randomUUID } from 'crypto';
import type { EngineName, ExperimentStatus, Task, TaskDAG } from './types';
import { runDag, topoOrder, type Executor } from './dag';
import { saveExperiment, getExperimentsMap as readMap } from './store';
import { runPythonAnalysis, runPythonTreatment, runPythonTranslate, runPythonHypothesis, runPythonVerification, runPythonChemlab } from './pythonExecutors';
import { validateOutput } from './validate';

// Mirrors the BlackMind SportsScienceAdapter task shape: { id, agent, inputs,
// depends_on } — the engine arrives in the `agent` field and the evidence/
// is_gate/status fields are absent. Accept that minimal shape (plus the route's
// fuller Task shape) and normalize every task to the full internal Task
// contract so adapter payloads are E1-classifiable.
export type TaskInput = Omit<Partial<Task>, 'id' | 'engine' | 'inputs' | 'depends_on'> & {
  id: string;
  agent?: string;
  engine?: EngineName;
  inputs?: Record<string, unknown>;
  depends_on?: string[];
};

// Upstream executor outputs are wrapped in the BlackMind { data: [...] }
// contract, so the coach's 'risk_tier' lookup must unwrap. Handle both shapes
// (legacy flat dict OR wrapped array) and prefer the wrapped shape's inner
// object so the metrics dict passed to the Python treatment runner is the raw
// flat one it expects.
function unwrapMetrics(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const obj = v as Record<string, unknown>;
  if (Array.isArray(obj.data)) {
    for (const row of obj.data) {
      if (typeof row === 'object' && row !== null && 'risk_tier' in row) {
        return row as Record<string, unknown>;
      }
    }
  }
  if ('risk_tier' in obj) return obj;
  return undefined;
}

const makeExecutor: Executor = (task, upstream) => {
  if (task.engine === 'onco_stat_crew') {
    return runPythonAnalysis(task.inputs);
  }
  if (task.engine === 'onco_coach') {
    // Merge upstream onco_stat_crew metrics (keyed by task id) into coach
    // input, matching the Python skill_bridge._treatment_result contract:
    // prefer explicit metrics, then any upstream dict containing 'risk_tier'.
    const metrics =
      task.inputs?.metrics ??
      [...upstream.values()].map(unwrapMetrics).find((m) => m !== undefined);
    return runPythonTreatment((metrics ?? {}) as Record<string, unknown>);
  }
  if (task.engine === 'translation') {
    const term = String(task.inputs?.term ?? '');
    const value = task.inputs?.value !== undefined ? Number(task.inputs.value) : undefined;
    const fromSports = (task.inputs?.from_sports ?? true) as boolean;
    return runPythonTranslate(term, value, fromSports);
  }
  if (task.engine === 'hypothesis') {
    return runPythonHypothesis(task.inputs);
  }
  if (task.engine === 'verification') {
    return runPythonVerification(task.inputs);
  }
  if (task.engine === 'chemlab') {
    return runPythonChemlab(task.inputs);
  }
  return Promise.resolve({
    success: false,
    data: { data: [], error: `unknown engine ${task.engine}` },
    error: `unknown engine ${task.engine}`,
    evidence_tier: 'E3',
  });
};

export async function submitExperiment(input: {
  cancer_type: string;
  goal: string;
  tasks: TaskInput[];
}): Promise<{ experiment_id: string; task_count: number }> {
  const experiment_id = randomUUID();
  const created_at = new Date().toISOString();
  // Gate policy for this fire-and-forget adapter path: gates are AUTO-APPROVED
  // at submission (is_gate -> false) so the DAG settles instead of hanging in
  // 'awaiting_human' forever. Interactive human gate approval is a future UI
  // concern.
  // The top-level cancer_type is threaded into every task's inputs so
  // cancer-type-aware executors receive it even when callers only set it at the
  // top level.
  const tasks: Task[] = input.tasks.map((t) => {
    const merged = { ...(t.inputs ?? {}) };
    merged.cancer_type = (t.inputs?.cancer_type as string) ?? input.cancer_type;
    return {
      id: t.id,
      engine: (t.agent ?? t.engine) as Task['engine'],
      inputs: merged,
      depends_on: t.depends_on ?? [],
      is_gate: false,
      status: 'pending',
      evidence: t.evidence ?? { tier: 'E1', lineageParentIds: [] },
    };
  });
  const dag: TaskDAG = {
    experiment_id,
    goal: input.goal,
    tasks,
    created_at,
  };
  if (dag.tasks.length === 0) throw new Error('experiment has no tasks');
  topoOrder(dag.tasks);
  const running: ExperimentStatus = {
    experiment_id,
    status: 'running',
    tasks,
    goal: input.goal,
    created_at,
    updated_at: created_at,
  };
  await saveExperiment(running);
  const run = runDag(dag, makeExecutor);
  void run.promise
    .then(async (status) => {
      for (const task of status.tasks) {
        if (task.result === undefined) continue;
        const check = validateOutput(task.result);
        if (!check.valid) {
          try {
            console.warn(
              '[biotech] experiment result failed validation',
              experiment_id,
              task.id,
              check.errors,
            );
          } catch {
            // logging itself must never throw
          }
        }
      }
      await saveExperiment(status);
    })
    .catch((err) => {
      try {
        console.error(
          '[biotech] failed to persist experiment',
          experiment_id,
          err instanceof Error ? err.message : err,
        );
      } catch {
        // logging itself must never throw
      }
    });
  return { experiment_id, task_count: input.tasks.length };
}

export async function getExperimentsMap(): Promise<Record<string, unknown>> {
  return readMap() as unknown as Record<string, unknown>;
}
