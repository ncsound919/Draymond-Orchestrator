// ============================================================================
// Command Center — SEO task feed (command_seo_tasks)
// ============================================================================
// CRUD + status toggles against the local SQLite store. Server-side only.
// ============================================================================

import { createDraymondAdminClient } from '@/lib/draymond/client';
import type { SeoPriority, SeoStatus, SeoTask, SeoTaskInsert } from './types';

const PRIORITIES: SeoPriority[] = ['low', 'medium', 'high', 'urgent'];
const STATUSES: SeoStatus[] = ['todo', 'in_progress', 'blocked', 'done'];

function isPriority(v: unknown): v is SeoPriority {
  return typeof v === 'string' && (PRIORITIES as string[]).includes(v);
}
function isStatus(v: unknown): v is SeoStatus {
  return typeof v === 'string' && (STATUSES as string[]).includes(v);
}

export async function listSeoTasks(): Promise<SeoTask[]> {
  const client = createDraymondAdminClient();
  const { data, error } = await client
    .from('command_seo_tasks')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SeoTask[];
}

export async function getSeoTask(id: string): Promise<SeoTask | null> {
  const client = createDraymondAdminClient();
  const { data, error } = await client.from('command_seo_tasks').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SeoTask) ?? null;
}

export async function createSeoTask(input: SeoTaskInsert): Promise<SeoTask> {
  const client = createDraymondAdminClient();
  const { data, error } = await client
    .from('command_seo_tasks')
    .insert({ ...input, title: input.title, priority: input.priority ?? 'medium', status: input.status ?? 'todo', is_done: input.is_done ?? false })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as SeoTask;
}

export async function updateSeoTask(
  id: string,
  patch: Partial<Omit<SeoTask, 'id' | 'created_at' | 'updated_at'>>,
): Promise<SeoTask> {
  const client = createDraymondAdminClient();
  const { data, error } = await client
    .from('command_seo_tasks')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as SeoTask;
}

/** Toggle a task done/not-done; sets completed_at when done, clears when undone. */
export async function setSeoTaskDone(id: string, done: boolean): Promise<SeoTask> {
  const patch: Partial<Omit<SeoTask, 'id' | 'created_at' | 'updated_at'>> = {
    is_done: done,
    status: done ? 'done' : 'todo',
    completed_at: done ? new Date().toISOString() : null,
  };
  return updateSeoTask(id, patch);
}

export async function setSeoTaskStatus(id: string, status: unknown): Promise<SeoTask> {
  if (!isStatus(status)) throw new Error(`Invalid status: ${String(status)}`);
  return updateSeoTask(id, { status, is_done: status === 'done' });
}

export async function setSeoTaskPriority(id: string, priority: unknown): Promise<SeoTask> {
  if (!isPriority(priority)) throw new Error(`Invalid priority: ${String(priority)}`);
  return updateSeoTask(id, { priority });
}

export async function deleteSeoTask(id: string): Promise<void> {
  const client = createDraymondAdminClient();
  const { error } = await client.from('command_seo_tasks').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function seoTaskCounts(): Promise<{
  total: number;
  done: number;
  pending: number;
  byPriority: Record<SeoPriority, number>;
}> {
  const tasks = await listSeoTasks();
  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<SeoPriority, number>;
  for (const t of tasks) {
    if (isPriority(t.priority)) byPriority[t.priority] += 1;
  }
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.is_done).length,
    pending: tasks.length - tasks.filter((t) => t.is_done).length,
    byPriority,
  };
}
