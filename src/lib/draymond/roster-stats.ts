// ============================================================================
// DRAYMOND ROSTER STATS — surface RepoRank / Grader / Vibe-Reality benchmark
// scores on the agent roster and compute % gains between benchmark runs.
// ============================================================================
// The roster grid (/agents) renders `stats` bars per agent from registry.json.
// This module syncs those bars with the latest deep-scores persisted by the
// benchmark cycle, so the roster reflects what RepoRank/Grader actually graded
// instead of static seed values. It also computes the % gain between the two
// most recent runs per component — the baseline Draymond uses to recognise the
// value of component improvements and feed the self-learning loop.
// ============================================================================

import { createDraymondAdminClient } from './client';
import { getAllAgents, updateAgentStats } from '@/lib/registry/agent-store';
import type { AgentStat } from '@/lib/registry/types';
import type { ComponentClass, DeepScoreResult } from './types';

export interface RosterBenchmarkSnapshot {
  component_class: ComponentClass;
  component_slug: string;
  component_name: string;
  weakness_score: number;
  deep_scores: Record<string, DeepScoreResult>;
  run_at: string;
}

export interface BenchmarkGain {
  component_class: ComponentClass;
  component_slug: string;
  component_name: string;
  scorer: string;
  /** Score on the previous run (null when there was no prior score). */
  baseline: number | null;
  /** Score on the most recent run. */
  current: number | null;
  /** pct = (current - baseline) / baseline * 100, rounded to 1dp. null if incalculable. */
  gainPct: number | null;
  run_at: string;
}

/** Normalise a 0–100 score for a roster bar, rejecting null/NaN. */
function statValue(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, score));
}

/**
 * Derive roster stat bars from a deep-score snapshot. Higher = better.
 * `weakness_score` is inverted (100 - score) so it reads as "Health" on a bar.
 */
export function statsFromSnapshot(
  snapshot: Pick<RosterBenchmarkSnapshot, 'weakness_score' | 'deep_scores'>
): AgentStat[] {
  const stats: AgentStat[] = [];
  const deep = snapshot.deep_scores ?? {};

  for (const [scorer, label] of [
    ['reporank', 'RepoRank'],
    ['grader', 'Grader'],
    ['vibe-reality', 'Vibe'],
  ] as const) {
    const value = statValue(deep[scorer]?.score);
    if (value != null) stats.push({ label, value: Math.round(value) });
  }

  const health = statValue(100 - snapshot.weakness_score);
  if (health != null) stats.push({ label: 'Health', value: Math.round(health) });

  return stats;
}

/**
 * Read the latest benchmark row per component (across all classes) that carries
 * deep scores. Rows are ordered newest-first; the first per slug wins.
 */
export async function latestDeepScoredBenchmarks(limit = 1000): Promise<RosterBenchmarkSnapshot[]> {
  const supabase = createDraymondAdminClient();
  const { data, error } = await supabase
    .from('draymond_benchmarks')
    .select('component_class, component_slug, component_name, weakness_score, deep_scores, run_at')
    .order('run_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load deep-scored benchmarks: ${error.message}`);

  const seen = new Set<string>();
  const out: RosterBenchmarkSnapshot[] = [];
  for (const row of data ?? []) {
    const key = `${row.component_class}:${row.component_slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Only rows that actually got deep-scored are roster-relevant.
    const deep = (row.deep_scores ?? {}) as Record<string, DeepScoreResult>;
    if (Object.keys(deep).length === 0) continue;
    out.push({
      component_class: row.component_class,
      component_slug: row.component_slug,
      component_name: row.component_name,
      weakness_score: Number(row.weakness_score ?? 0),
      deep_scores: deep,
      run_at: String(row.run_at ?? ''),
    });
  }
  return out;
}

/**
 * Resolve a component's entity slug to a roster agent slug.
 * Entity rows carry `linked_agent_id` → draymond_agents.slug; when that is
 * absent, fall back to matching the entity slug directly against agent slugs.
 */
async function resolveAgentSlugByEntity(
  entitySlug: string,
  entityBySlug: Map<string, string | null>,
  agentSlugs: Set<string>
): Promise<string | null> {
  if (agentSlugs.has(entitySlug)) return entitySlug;

  const linkedAgentId = entityBySlug.get(entitySlug);
  if (linkedAgentId && agentSlugs.has(linkedAgentId)) return linkedAgentId;
  return null;
}

/**
 * Sync roster stat bars for every agent that has a deep-scored entity component.
 * Returns the number of agents whose stats were updated.
 */
export async function syncRosterBenchmarks(): Promise<{
  updated: number;
  statsBySlug: Record<string, AgentStat[]>;
}> {
  const [agents, snapshots] = await Promise.all([
    getAllAgents(),
    latestDeepScoredBenchmarks(),
  ]);
  const agentSlugs = new Set(agents.map((a) => a.slug));

  // Entity slug → linked_agent_id, so we can link entity components to agents.
  const entityBySlug = new Map<string, string | null>();
  const supabase = createDraymondAdminClient();
  const { data: entityRows, error } = await supabase
    .from('draymond_entities')
    .select('slug, linked_agent_id');
  if (!error) {
    for (const e of entityRows ?? []) entityBySlug.set(String(e.slug), e.linked_agent_id != null ? String(e.linked_agent_id) : null);
  }

  const bySlug = new Map<string, RosterBenchmarkSnapshot>();
  for (const s of snapshots) {
    const agentSlug = await resolveAgentSlugByEntity(s.component_slug, entityBySlug, agentSlugs);
    if (!agentSlug) continue;
    if (!bySlug.has(agentSlug)) bySlug.set(agentSlug, s);
  }

  const statsBySlug: Record<string, AgentStat[]> = {};
  for (const [agentSlug, snapshot] of bySlug) {
    const stats = statsFromSnapshot(snapshot);
    if (stats.length === 0) continue;
    await updateAgentStats(agentSlug, stats);
    statsBySlug[agentSlug] = stats;
  }

  return { updated: Object.keys(statsBySlug).length, statsBySlug };
}

// ── % gains ─────────────────────────────────────────────────────────────────

function pctGain(baseline: number | null, current: number | null): number | null {
  if (baseline == null || current == null || baseline === 0) return null; // division by zero — no gain computable
  const pct = ((current - baseline) / Math.abs(baseline)) * 100;
  return Math.round(pct * 10) / 10;
}

/**
 * Compute the % gain per scorer between the two most recent deep-scored runs of
 * a component. Also includes the weakness-score delta under scorer `weakness`
 * (inverted so a positive gain means fewer weaknesses).
 */
export async function computeBenchmarkGains(
  componentClass: ComponentClass,
  componentSlug: string
): Promise<BenchmarkGain[]> {
  const supabase = createDraymondAdminClient();
  const { data, error } = await supabase
    .from('draymond_benchmarks')
    .select('component_name, weakness_score, deep_scores, run_at')
    .eq('component_class', componentClass)
    .eq('component_slug', componentSlug)
    .order('run_at', { ascending: false })
    .limit(2);
  if (error) throw new Error(`Failed to load gains for ${componentSlug}: ${error.message}`);

  const runs = (data ?? []) as Array<{
    component_name: string;
    weakness_score: number;
    deep_scores: Record<string, DeepScoreResult> | null;
    run_at: string;
  }>;
  if (runs.length === 0) return [];
  const newest = runs[0];
  const previous = runs[1] ?? null;

  const scorers = ['reporank', 'grader', 'vibe-reality'] as const;
  const gains: BenchmarkGain[] = [];
  for (const scorer of scorers) {
    const base = previous?.deep_scores?.[scorer]?.score ?? null;
    const current = newest.deep_scores?.[scorer]?.score ?? null;
    gains.push({
      component_class: componentClass,
      component_slug: componentSlug,
      component_name: newest.component_name,
      scorer,
      baseline: base,
      current,
      gainPct: pctGain(base, current),
      run_at: newest.run_at,
    });
  }

  // Weakness is inverted: a falling weakness score is a gain, so compute the
  // gain on the health (100 - weakness) axis.
  const baseWeak = previous?.weakness_score != null ? Number(previous.weakness_score) : null;
  const curWeak = newest.weakness_score != null ? Number(newest.weakness_score) : null;
  const weaknessGain =
    baseWeak != null && curWeak != null ? pctGain(100 - baseWeak, 100 - curWeak) : null;
  gains.push({
    component_class: componentClass,
    component_slug: componentSlug,
    component_name: newest.component_name,
    scorer: 'weakness',
    baseline: baseWeak != null ? 100 - baseWeak : null,
    current: curWeak != null ? 100 - curWeak : null,
    gainPct: weaknessGain,
    run_at: newest.run_at,
  });

  return gains;
}

/**
 * Compute gains for every component that has deep scores, and return them keyed
 * by `class:slug`. Used by the nightly self-learning pass.
 */
export async function allBenchmarkGains(): Promise<BenchmarkGain[]> {
  const snapshots = await latestDeepScoredBenchmarks();
  const out: BenchmarkGain[] = [];
  for (const s of snapshots) {
    out.push(...(await computeBenchmarkGains(s.component_class, s.component_slug)));
  }
  return out;
}
