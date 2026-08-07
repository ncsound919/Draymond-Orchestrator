import { createDraymondAdminClient } from '@/lib/draymond/client';
import { getTrend } from '@/lib/draymond/benchmarking';
import { listUpgradeQueue } from '@/lib/draymond/upgrade-queue';
import type { ComponentClass, UpgradeQueueItem } from '@/lib/draymond/types';

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

export async function upgradeQueue(status?: UpgradeQueueItem['status']): Promise<UpgradeQueueItem[]> {
  return listUpgradeQueue(status);
}

/** Latest weakness-score history for a component (oldest → newest). */
export async function trendFor(componentClass: ComponentClass, slug: string): Promise<number[]> {
  return getTrend(componentClass, slug, 14);
}
