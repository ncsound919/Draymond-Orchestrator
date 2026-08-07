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

/**
 * Batched trends for many components in one query per class. Keys are
 * `${component_class}:${component_slug}` so slugs shared across classes never
 * collide. Returns newest-first per component (matching getTrend's shape).
 */
export async function trendsFor(
  items: Array<{ component_class: ComponentClass; component_slug: string }>
): Promise<Record<string, number[]>> {
  const byClass = new Map<ComponentClass, string[]>();
  for (const item of items) {
    const list = byClass.get(item.component_class) ?? [];
    list.push(item.component_slug);
    byClass.set(item.component_class, list);
  }
  const out: Record<string, number[]> = {};
  for (const [componentClass, slugs] of byClass) {
    const supabase = createDraymondAdminClient();
    const { data, error } = await supabase
      .from('draymond_benchmarks')
      .select('component_slug, weakness_score, run_at')
      .eq('component_class', componentClass)
      .in('component_slug', slugs)
      .order('run_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(`Failed to load trends: ${error.message}`);
    const perSlug: Record<string, number[]> = {};
    for (const r of (data ?? []) as Array<{ component_slug: string; weakness_score: number }>) {
      (perSlug[r.component_slug] ??= []).push(Number(r.weakness_score));
    }
    for (const slug of slugs) {
      out[`${componentClass}:${slug}`] = (perSlug[slug] ?? []).slice(0, 14);
    }
  }
  return out;
}
