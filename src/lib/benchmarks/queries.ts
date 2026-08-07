import { createDraymondAdminClient } from '@/lib/draymond/client';
import type { ComponentClass } from '@/lib/draymond/types';

export interface BenchmarkRow {
  id: string;
  run_id: string;
  component_class: ComponentClass;
  component_slug: string;
  component_name: string;
  weakness_score: number;
  metrics: Record<string, unknown>;
  run_at: string;
}

export async function latestBenchmarks(limit = 200): Promise<BenchmarkRow[]> {
  const supabase = createDraymondAdminClient();
  const { data, error } = await supabase
    .from('draymond_benchmarks')
    .select('*')
    .order('run_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load benchmarks: ${error.message}`);
  return (data ?? []) as BenchmarkRow[];
}

export interface QueueRow {
  id: string;
  component_class: ComponentClass;
  component_slug: string;
  component_name: string;
  weakness_score: number;
  reasons: string[];
  proposed_action: string | null;
  deep_scores: Record<string, unknown>;
  status: string;
}

export async function upgradeQueue(status?: string): Promise<QueueRow[]> {
  const supabase = createDraymondAdminClient();
  let q = supabase.from('draymond_upgrade_queue').select('*').order('weakness_score', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(`Failed to load upgrade queue: ${error.message}`);
  return (data ?? []) as QueueRow[];
}

export async function trendFor(componentClass: ComponentClass, slug: string): Promise<number[]> {
  const supabase = createDraymondAdminClient();
  const { data, error } = await supabase
    .from('draymond_benchmarks')
    .select('weakness_score')
    .eq('component_class', componentClass)
    .eq('component_slug', slug)
    .order('run_at', { ascending: false })
    .limit(14);
  if (error) throw new Error(`Failed to load trend: ${error.message}`);
  return (data ?? []).map((r: { weakness_score: number }) => Number(r.weakness_score)).reverse();
}
