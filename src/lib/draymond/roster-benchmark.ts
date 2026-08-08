// ============================================================================
// DRAYMOND ROSTER BENCHMARK — RepoRank / Grader stats for pictured agents
// ============================================================================
// For every roster agent that has a real portrait AND a known GitHub repo,
// run the deep-scorers (RepoRank + Grader + Vibe-Reality) and record a
// benchmark row. The weakness scores feed the upgrade queue so the
// self-learning loop and repair team can work on the weakest agents in the
// background.
// ============================================================================

import { getAllAgents, hasRealAvatar } from '@/lib/registry/agent-store';
import { deepScore } from './deep-scorers';
import { recordDeepScores, recordRun } from './benchmarking';
import { queueWeakest } from './upgrade-queue';
import { resolveRosterRepo } from './roster-repos';
import type { BenchmarkMetric, DeepScoreResult, WeaknessScore } from './types';

function buildRunId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `roster-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Convert deep scores (higher = better) into a weakness score (0-100, higher = worse). */
function combinedWeakness(
  deep: Record<string, DeepScoreResult>
): { score: number; reasons: string[] } {
  const scores = Object.values(deep)
    .map((r) => r.score)
    .filter((s): s is number => typeof s === 'number');
  if (scores.length === 0) {
    const errs = Object.values(deep).filter((r) => r.error);
    return {
      score: 50,
      reasons:
        errs.length > 0
          ? errs.map((r) => `${r.scorer}: ${r.error}`)
          : ['no deep scores recorded'],
    };
  }
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    score: Math.round(Math.max(0, Math.min(100, 100 - avg))),
    reasons: [`avg deep score ${avg.toFixed(1)}/100 across ${scores.length} scorers`],
  };
}

export interface RosterBenchmarkResult {
  run_id: string;
  measured: number;
  recorded: number;
  queued: number;
  deepScored: number;
}

/**
 * Benchmark the pictured roster agents (real portrait + resolvable repo).
 * Each agent's repo is deep-scored with RepoRank / Grader / Vibe-Reality,
 * results are persisted to draymond_benchmarks, and the weakest are queued
 * for the self-learning loop to work on.
 */
export async function benchmarkRoster(
  opts: { queueLimit?: number } = {}
): Promise<RosterBenchmarkResult> {
  const limit = Math.max(1, opts.queueLimit ?? 10);
  const agents = await getAllAgents();

  const targets = agents.filter(
    (a) => hasRealAvatar(a) && resolveRosterRepo(a.slug, a.sourceUrl)
  );

  const metrics: BenchmarkMetric[] = [];
  const scoresMap: Record<string, number> = {};
  const reasonsMap: Record<string, string[]> = {};
  const deepMap: Record<string, Record<string, DeepScoreResult>> = {};
  let deepScored = 0;

  for (const agent of targets) {
    const repo = resolveRosterRepo(agent.slug, agent.sourceUrl) as string;
    const deep = await deepScore('entity', agent.slug, agent.name, repo);
    deepMap[agent.slug] = deep;

    if (Object.values(deep).some((r) => r.score != null)) deepScored++;

    const { score, reasons } = combinedWeakness(deep);
    scoresMap[agent.slug] = score;
    reasonsMap[agent.slug] = reasons;

    const scorerScores = Object.fromEntries(
      Object.entries(deep).map(([k, v]) => [k, v.score])
    );
    metrics.push({
      component_class: 'entity',
      component_slug: agent.slug,
      component_name: agent.name,
      metrics: { repo, deep_scores: scorerScores },
      evidence: reasons.join('; ') || 'roster deep-score benchmark',
    });
  }

  if (metrics.length === 0) {
    return { run_id: '', measured: 0, recorded: 0, queued: 0, deepScored: 0 };
  }

  const run_id = buildRunId();
  const { recorded } = await recordRun('entity', metrics, scoresMap, run_id);
  try {
    await recordDeepScores(run_id, 'entity', deepMap);
  } catch (err) {
    console.error('[roster-benchmark] failed to persist deep scores:', err);
  }

  const ranked: WeaknessScore[] = targets.map((a) => ({
    component_class: 'entity',
    component_slug: a.slug,
    component_name: a.name,
    score: scoresMap[a.slug] ?? 0,
    reasons: reasonsMap[a.slug] ?? [],
    trend: 'flat',
  }));

  const { queued } = await queueWeakest(ranked, limit, deepMap);

  return { run_id, measured: targets.length, recorded, queued, deepScored };
}
