// ============================================================================
// Worker Task Queue — tasks the boss assigns to remote workers (Open Chat).
// Status flow: queued → claimed → completed | failed
// ============================================================================

import { createDraymondAdminClient } from './client';

export interface WorkerTask {
  id: string;
  worker_id: string | null;
  skill_pack_id: string | null;
  payload: Record<string, unknown>;
  status: 'queued' | 'claimed' | 'in_progress' | 'needs_review' | 'completed' | 'failed';
  due_at: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  result: Record<string, unknown>;
  artifact_refs: string[];
  error: string | null;
  created_at: string;
}

export interface EnqueueInput {
  skill_pack_id?: string;
  payload?: Record<string, unknown>;
  due_at?: string;
}

export async function enqueueWorkerTask(input: EnqueueInput): Promise<string> {
  const db = createDraymondAdminClient();
  // The builder auto-fills the id (uuid) and created_at columns on insert; the
  // returned row carries the generated id back to the caller.
  const { data, error } = await db
    .from('draymond_worker_tasks')
    .insert({
      worker_id: null,
      skill_pack_id: input.skill_pack_id ?? null,
      payload: input.payload ?? {},
      status: 'queued',
      due_at: input.due_at ?? null,
    })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to enqueue worker task: ${error.message}`);
  }
  return (data as WorkerTask).id;
}

export async function pullDueTasks(workerId: string, limit = 10): Promise<WorkerTask[]> {
  const db = createDraymondAdminClient();
  // A worker pulls queued tasks that are unassigned (worker_id IS NULL) OR
  // assigned to them. The query builder's `.or()` cannot express an `IS NULL`
  // clause, so each scope is selected separately and merged below.
  const { data: unassigned, error: errUnassigned } = await db
    .from('draymond_worker_tasks')
    .select('*')
    .eq('status', 'queued')
    .is('worker_id', null);
  if (errUnassigned) {
    throw new Error(`Failed to pull worker tasks: ${errUnassigned.message}`);
  }
  const { data: mine, error: errMine } = await db
    .from('draymond_worker_tasks')
    .select('*')
    .eq('status', 'queued')
    .eq('worker_id', workerId);
  if (errMine) {
    throw new Error(`Failed to pull worker tasks: ${errMine.message}`);
  }

  const now = new Date().toISOString();
  // due_at is NULL (no deadline) or already due; merged rows deduped by id.
  const due = [...(unassigned ?? []), ...(mine ?? [])].filter(
    (t: WorkerTask) => t.due_at == null || t.due_at <= now
  );
  const byId = new Map<string, WorkerTask>();
  for (const t of due) byId.set(t.id, t);
  return [...byId.values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, limit);
}

export async function claimTask(id: string, workerId: string): Promise<boolean> {
  const db = createDraymondAdminClient();
  const { data, error } = await db
    .from('draymond_worker_tasks')
    .update({
      status: 'claimed',
      worker_id: workerId,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'queued')
    .select();
  if (error) {
    throw new Error(`Failed to claim worker task: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

export async function reportTask(
  id: string,
  result: Record<string, unknown>,
  artifactRefs?: string[],
  error?: string,
  workerId?: string
): Promise<boolean> {
  const db = createDraymondAdminClient();
  // Only a claimed or in-progress task can be reported, and only by its
  // assigned worker when one is supplied.
  let query = db
    .from('draymond_worker_tasks')
    .update({
      status: error ? 'failed' : 'completed',
      result: result ?? {},
      artifact_refs: artifactRefs ?? [],
      error: error ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', ['claimed', 'in_progress']);
  if (workerId) query = query.eq('worker_id', workerId);
  const { data, error: err } = await query.select();
  if (err) {
    throw new Error(`Failed to report worker task: ${err.message}`);
  }
  return (data?.length ?? 0) > 0;
}

export async function getWorkerTask(id: string): Promise<WorkerTask | null> {
  const db = createDraymondAdminClient();
  const { data, error } = await db
    .from('draymond_worker_tasks')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to get worker task: ${error.message}`);
  }
  return (data as WorkerTask | null) ?? null;
}

export interface DispatchWorkerTasksConfig {
  tasks?: Array<{ skill_pack_id?: string; payload?: Record<string, unknown>; due_at?: string }>;
}

export async function dispatchWorkerTasks(config: DispatchWorkerTasksConfig): Promise<{ enqueued: number }> {
  const tasks = config.tasks ?? [];
  for (const t of tasks) {
    await enqueueWorkerTask({ skill_pack_id: t.skill_pack_id, payload: t.payload, due_at: t.due_at });
  }
  return { enqueued: tasks.length };
}
