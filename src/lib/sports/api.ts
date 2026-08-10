import { randomUUID } from 'crypto';
import type { EngineName, ExperimentStatus, Task, TaskDAG } from './types';
import { runDag, topoOrder, type Executor } from './dag';
import { saveExperiment, getExperimentsMap as readMap } from './store';
import { runPythonMetrics, runPythonCoach, runPythonTranslate, runPythonInsights, runPythonFormula, runPythonLayers } from './pythonExecutors';
import { runRustSimPlay, runRustSimBatch } from './rustExecutors';
import { validateOutput } from './validate';

// The BlackMind SportsScienceAdapter posts tasks shaped { id, agent, inputs,
// depends_on } — the engine arrives in the `agent` field and the evidence/
// is_gate/status fields are absent. Accept that minimal shape (plus the route's
// fuller Task shape) and normalize every task to the full internal Task
// contract so the adapter's payloads are E1-classifiable.
export type TaskInput = Omit<Partial<Task>, 'id' | 'engine' | 'inputs' | 'depends_on'> & {
  id: string;
  agent?: string;
  engine?: EngineName;
  inputs?: Record<string, unknown>;
  depends_on?: string[];
};

// Upstream executor outputs are now wrapped in the BlackMind { data: [...] }
// contract by pythonExecutors, so the coach's 'ter' lookup must unwrap. Handle
// both shapes (legacy flat dict OR wrapped array) and prefer the wrapped
// shape's inner object so the metrics dict passed to the Python coach runner
// is the raw flat one it expects.
function unwrapMetrics(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const obj = v as Record<string, unknown>;
  if (Array.isArray(obj.data)) {
    for (const row of obj.data) {
      if (typeof row === 'object' && row !== null && 'ter' in row) {
        return row as Record<string, unknown>;
      }
    }
  }
  if ('ter' in obj) return obj;
  return undefined;
}

const makeExecutor: Executor = (task, upstream) => {
  if (task.engine === 'stat_crew') {
    return runPythonMetrics(task.inputs);
  }
  if (task.engine === 'coach') {
    // Merge upstream stat_crew metrics (keyed by task id) into coach input,
    // matching the Python skill_bridge._coach_result contract: prefer explicit
    // metrics, then any upstream dict containing 'ter'.
    const metrics =
      task.inputs?.metrics ??
      [...upstream.values()].map(unwrapMetrics).find((m) => m !== undefined);
    return runPythonCoach(
      String(task.inputs?.sport ?? 'basketball'),
      (metrics ?? {}) as Record<string, unknown>,
    );
  }
  if (task.engine === 'sim-kernel') {
    // The sim-kernel engine handles its own sport (NBA) in its play inputs;
    // dispatch sim-batch vs sim-play via the command input, defaulting to
    // sim-play so a bare task yields a single SimulationResult.
    const sim = task.inputs?.command === 'sim-batch'
      ? runRustSimBatch(task.inputs)
      : runRustSimPlay(task.inputs);
    return sim;
  }
  if (task.engine === 'translation') {
    const term = String(task.inputs?.term ?? '');
    const value = task.inputs?.value !== undefined ? Number(task.inputs.value) : undefined;
    const fromSports = (task.inputs?.from_sports ?? true) as boolean;
    return runPythonTranslate(term, value, fromSports);
  }
  if (task.engine === 'insights') {
    const profile = (task.inputs?.profile ?? {}) as Record<string, unknown>;
    const fromBiotech = (task.inputs?.from_biotech ?? false) as boolean;
    return runPythonInsights(profile, fromBiotech);
  }
  if (task.engine === 'formula') {
    const box = (task.inputs?.box ?? {}) as Record<string, unknown>;
    const stat = task.inputs?.stat !== undefined ? String(task.inputs.stat) : undefined;
    return runPythonFormula(box, stat);
  }
  if (task.engine === 'layers') {
    const terms = (task.inputs?.terms ?? []) as string[];
    const layer = String(task.inputs?.layer ?? 'all');
    const fromSports = (task.inputs?.from_sports ?? true) as boolean;
    return runPythonLayers(terms, layer, fromSports);
  }
  return Promise.resolve({
    success: false,
    data: { data: [], error: `unknown engine ${task.engine}` },
    error: `unknown engine ${task.engine}`,
    evidence_tier: 'E3',
  });
};

export async function submitExperiment(input: {
  sport: string;
  goal: string;
  tasks: TaskInput[];
}): Promise<{ experiment_id: string; task_count: number }> {
  const experiment_id = randomUUID();
  const created_at = new Date().toISOString();
  // Gate policy for this fire-and-forget adapter path: there is no approval UI
  // and the BlackMind adapter polls to a TERMINAL state, so gates are
  // AUTO-APPROVED at submission (is_gate -> false, treated as non-blocking) so
  // the DAG settles instead of hanging in 'awaiting_human' forever. Interactive
  // human gate approval is a future UI concern.
  // The top-level sport is threaded into every task's inputs so sport-aware
  // executors (coach) receive it even when callers only set it at the top level.
  // sim-kernel tasks carry their sport inside the play/defense inputs (NBA), so
  // the top-level fallback must NOT overwrite it — skip injection for that
  // engine so the Rust engine sees the caller's real sport.
  const tasks: Task[] = input.tasks.map((t) => {
    const merged = { ...(t.inputs ?? {}) };
    if (t.agent !== 'sim-kernel' && t.engine !== 'sim-kernel') {
      merged.sport = (t.inputs?.sport as string) ?? input.sport;
    }
    return {
      id: t.id,
      // Adapter-style payloads carry the engine in `agent`; route-style payloads
      // carry it in `engine`. Resolve either so the executor contract is met.
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
  // Validate up front (mirrors runDag's synchronous checks) so malformed DAGs
  // (empty tasks, cycles, unknown deps) reject before any row is persisted or
  // the run is launched.
  if (dag.tasks.length === 0) throw new Error('experiment has no tasks');
  topoOrder(dag.tasks);
  // Persist a 'running' row before launching so the experiment is visible even
  // if the process dies mid-run; the terminal save below upserts over it.
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
      // Pre-storage validation gate: run the ScientificOutputValidator-shaped
      // check over every task's result (the experiment's scientific output)
      // before persisting the terminal row. Non-blocking by design — a failed
      // or partial experiment must still be persisted so its state is not
      // lost; validation failures are surfaced as warnings in the log.
      for (const task of status.tasks) {
        if (task.result === undefined) continue;
        const check = validateOutput(task.result);
        if (!check.valid) {
          try {
            console.warn(
              '[sports] experiment result failed validation',
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
      // A failed persistence on the terminal row must not crash the process.
      try {
        console.error(
          '[sports] failed to persist experiment',
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
