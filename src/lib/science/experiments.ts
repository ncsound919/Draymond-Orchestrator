/**
 * science/experiments.ts — Unified ExperimentEngine.
 *
 * Executes experiment specs of three types against the right adapter:
 *   - analysis    → sports/biotech metrics CLIs (existing runners)
 *   - simulation  → science_engine Python runtime (via ./sim)
 *   - translation → science_bridge whole-profile synthesis
 *
 * Results persist to the `science_experiments` SQLite table. The scheduler
 * `research_rotation` job drains the highest-priority ready experiment.
 */

import { randomUUID } from 'crypto';
import { createDraymondClient } from '@/lib/draymond/client';
import { readJsonState, writeJsonState, nowIso } from '@/lib/draymond/cognition';
import { runModelById } from './sim';
import { listGoals, listHypotheses, linkExperimentToHypothesis, updateHypothesisStatus } from './goals';
import { scoreGoal } from './priority';

export type ExperimentType = 'analysis' | 'simulation' | 'translation';
export type ExperimentStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ExperimentSpec {
  id?: string;
  goal_id: string;
  hypothesis_id?: string;
  domain: 'sports' | 'biotech';
  type: ExperimentType;
  model_id?: string;
  /** Type-specific inputs. */
  inputs: Record<string, unknown>;
  status?: ExperimentStatus;
  createdAt?: string;
}

export interface ScienceExperiment {
  experiment_id: string;
  goal_id: string;
  hypothesis_id?: string;
  domain: 'sports' | 'biotech';
  type: ExperimentType;
  model_id?: string;
  status: ExperimentStatus;
  result: Record<string, unknown>;
  evidence_tier: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

interface QueueState {
  queue: ExperimentSpec[];
  updatedAt?: string;
}

const QUEUE_FILE = 'experiment-queue';
const TABLE = 'science_experiments';

// ============================================================================
// Queue (JSON-state)
// ============================================================================

export async function listQueuedExperiments(): Promise<ExperimentSpec[]> {
  const state = await readJsonState<QueueState>(QUEUE_FILE, { queue: [] });
  return state.queue ?? [];
}

export async function enqueueExperiment(spec: ExperimentSpec): Promise<ExperimentSpec> {
  const queue = await listQueuedExperiments();
  const entry: ExperimentSpec = {
    ...spec,
    id: spec.id ?? randomUUID(),
    status: 'queued',
    createdAt: nowIso(),
  };
  queue.push(entry);
  await writeJsonState(QUEUE_FILE, { queue });
  return entry;
}

export async function dequeueExperiment(id: string): Promise<ExperimentSpec | null> {
  const queue = await listQueuedExperiments();
  const idx = queue.findIndex((q) => q.id === id);
  if (idx === -1) return null;
  const [entry] = queue.splice(idx, 1);
  await writeJsonState(QUEUE_FILE, { queue });
  return entry;
}

/** Highest-priority ready experiment (goal priority × hypothesis maturity). */
export async function nextExperiment(): Promise<ExperimentSpec | null> {
  const queue = await listQueuedExperiments();
  if (queue.length === 0) return null;
  const goals = await listGoals();
  const hypotheses = await listHypotheses();
  const scored = queue.map((spec) => {
    const goal = goals.find((g) => g.id === spec.goal_id);
    const goalHyps = spec.hypothesis_id
      ? hypotheses.filter((h) => h.id === spec.hypothesis_id)
      : (goal?.hypothesis_ids ?? []).map((id) => hypotheses.find((h) => h.id === id)).filter(Boolean) as typeof hypotheses;
    const score = goal ? scoreGoal(goal, goalHyps).score : 0.4;
    return { spec, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].spec;
}

// ============================================================================
// Persistence (SQLite)
// ============================================================================

export async function saveExperiment(exp: ScienceExperiment): Promise<void> {
  const supabase = await createDraymondClient();
  const { error } = await supabase.from(TABLE).upsert(
    {
      experiment_id: exp.experiment_id,
      goal_id: exp.goal_id,
      hypothesis_id: exp.hypothesis_id ?? null,
      domain: exp.domain,
      type: exp.type,
      model_id: exp.model_id ?? null,
      status: exp.status,
      result: JSON.stringify(exp.result ?? {}),
      evidence_tier: exp.evidence_tier,
      error: exp.error ?? null,
      created_at: exp.created_at,
      updated_at: exp.updated_at,
    },
    { onConflict: 'experiment_id' }
  );
  if (error) throw new Error(`Failed to save experiment: ${error.message}`);
}

export async function listExperiments(filters: { goal_id?: string; status?: ExperimentStatus } = {}): Promise<ScienceExperiment[]> {
  const supabase = await createDraymondClient();
  const { data, error } = await supabase.from(TABLE).select();
  if (error) throw new Error(`Failed to list experiments: ${error.message}`);
  let rows = (data ?? []) as Array<{
    experiment_id: string;
    goal_id: string;
    hypothesis_id?: string;
    domain: 'sports' | 'biotech';
    type: ExperimentType;
    model_id?: string;
    status: ExperimentStatus;
    result: string;
    evidence_tier: string;
    error?: string;
    created_at: string;
    updated_at: string;
  }>;
  if (filters.goal_id) rows = rows.filter((r) => r.goal_id === filters.goal_id);
  if (filters.status) rows = rows.filter((r) => r.status === filters.status);
  return rows.map((r) => ({
    experiment_id: r.experiment_id,
    goal_id: r.goal_id,
    hypothesis_id: r.hypothesis_id,
    domain: r.domain,
    type: r.type,
    model_id: r.model_id,
    status: r.status,
    result: (() => {
      try {
        return JSON.parse(r.result) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
    evidence_tier: r.evidence_tier,
    error: r.error,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function getExperiment(id: string): Promise<ScienceExperiment | null> {
  const all = await listExperiments();
  return all.find((e) => e.experiment_id === id) ?? null;
}

// ============================================================================
// Execution
// ============================================================================

/** Dispatch one experiment spec and persist the result. */
export async function runExperiment(spec: ExperimentSpec): Promise<ScienceExperiment> {
  const experiment_id = spec.id ?? randomUUID();
  const created_at = nowIso();
  const base: ScienceExperiment = {
    experiment_id,
    goal_id: spec.goal_id,
    hypothesis_id: spec.hypothesis_id,
    domain: spec.domain,
    type: spec.type,
    model_id: spec.model_id,
    status: 'running',
    result: {},
    evidence_tier: 'E3',
    created_at,
    updated_at: created_at,
  };
  await saveExperiment(base);
  if (spec.hypothesis_id) {
    await updateHypothesisStatus(spec.hypothesis_id, 'in_progress');
  }

  try {
    const result = await dispatch(spec);
    const completed: ScienceExperiment = {
      ...base,
      status: 'completed',
      result: result.result,
      evidence_tier: result.evidence_tier,
      error: result.error,
      updated_at: nowIso(),
    };
    await saveExperiment(completed);
    if (spec.hypothesis_id) {
      await linkExperimentToHypothesis(spec.hypothesis_id, experiment_id);
    }
    return completed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed: ScienceExperiment = {
      ...base,
      status: 'failed',
      error: message,
      updated_at: nowIso(),
    };
    await saveExperiment(failed);
    return failed;
  }
}

async function dispatch(spec: ExperimentSpec): Promise<{ result: Record<string, unknown>; evidence_tier: string; error?: string }> {
  if (spec.type === 'simulation') {
    const modelId = spec.model_id ?? '';
    const ticks = spec.inputs.ticks !== undefined ? Number(spec.inputs.ticks) : undefined;
    const params = (spec.inputs.params ?? {}) as Record<string, number>;
    const out = await runModelById(modelId, ticks, params);
    return {
      result: { ...out, model_id: modelId },
      evidence_tier: out.evidence_tier,
      error: out.error,
    };
  }
  if (spec.type === 'translation') {
    // Whole-profile cross-domain insight synthesis via the Python runner
    // (science_bridge), same contract as the translate/insights endpoint.
    const { runPythonInsights } = await import('@/lib/sports/pythonExecutors');
    const profile = (spec.inputs.profile ?? {}) as Record<string, unknown>;
    const fromBiotech = spec.domain === 'biotech';
    const res = await runPythonInsights(profile, fromBiotech);
    return {
      result: (res.data as { data?: unknown }).data !== undefined
        ? { report: (res.data as { data: unknown }).data }
        : { report: res.data },
      evidence_tier: res.evidence_tier,
      error: res.error ?? undefined,
    };
  }
  // analysis — domain metrics runner
  if (spec.domain === 'sports') {
    const { runPythonMetrics } = await import('@/lib/sports/pythonExecutors');
    const dataset = String(spec.inputs.dataset ?? '');
    const res = await runPythonMetrics({ dataset });
    return {
      result: (res.data as { data?: unknown }).data !== undefined
        ? { metrics: (res.data as { data: unknown }).data }
        : { metrics: res.data },
      evidence_tier: res.evidence_tier,
      error: res.error ?? undefined,
    };
  }
  const { runPythonAnalysis } = await import('@/lib/biotech/pythonExecutors');
  const dataset = String(spec.inputs.dataset ?? '');
  const res = await runPythonAnalysis({ dataset });
  return {
    result: (res.data as { data?: unknown }).data !== undefined
      ? { metrics: (res.data as { data: unknown }).data }
      : { metrics: res.data },
    evidence_tier: res.evidence_tier,
    error: res.error ?? undefined,
  };
}

/**
 * Scheduler hook: drain the highest-priority ready experiment (research rotation).
 * After draining, re-seeds the queue so science & sports keep producing.
 * Returns a summary suitable for the job runner / kairos.
 */
export async function researchRotation(): Promise<{
  processed: number;
  experiment_id?: string;
  goal_id?: string;
  status?: string;
  evidence_tier?: string;
  error?: string;
}> {
  const spec = await nextExperiment();
  if (!spec) return { processed: 0 };
  const experiment = await runExperiment(spec);
  await dequeueExperiment(spec.id ?? experiment.experiment_id);
  // Keep the pipeline fed: re-seed from the campaign backlog after each drain.
  const { ensureResearchBacklog } = await import('./campaigns');
  const backlog = await ensureResearchBacklog();
  return {
    processed: 1,
    experiment_id: experiment.experiment_id,
    goal_id: experiment.goal_id,
    status: experiment.status,
    evidence_tier: experiment.evidence_tier,
    error: experiment.error,
    ...(backlog.seededCount > 0
      ? { reseeded: backlog.seededCount, queue_after: backlog.queuedAfter }
      : {}),
  };
}
