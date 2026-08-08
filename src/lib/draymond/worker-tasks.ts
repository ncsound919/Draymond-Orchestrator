// ============================================================================
// Worker Task Queue — tasks the boss assigns to remote workers (Open Chat).
// Status flow: queued → claimed → in_progress → completed | failed
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
  const { data, error } = await db
    .from('draymond_worker_tasks')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`Failed to pull worker tasks: ${error.message}`);
  }
  // due_at is NULL (no deadline) or already due. The query builder's `.or()`
  // cannot express an `IS NULL` clause, so the OR is applied in JS.
  const now = new Date().toISOString();
  const due = (data ?? []).filter(
    (t: WorkerTask) => t.due_at == null || t.due_at <= now
  );
  return due.slice(0, limit);
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
  error?: string
): Promise<boolean> {
  const db = createDraymondAdminClient();
  const { data, error: err } = await db
    .from('draymond_worker_tasks')
    .update({
      status: error ? 'failed' : 'completed',
      result: result ?? {},
      artifact_refs: artifactRefs ?? [],
      error: error ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select();
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
