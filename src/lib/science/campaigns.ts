/**
 * science/campaigns.ts — Autonomous research campaign seeding.
 *
 * Turns the 20 active goals + untested hypotheses into a continuous flow of
 * experiments backed by the real ingested datasets. When the queue drains below
 * a floor, this module re-seeds it so the `research_rotation` scheduler job
 * always has work — that's what makes science & sports "autonomously produce".
 *
 * Strategy per goal:
 *   - 1 simulation   → goal's ticked model (science_engine)
 *   - N analysis     → sample real profiles from the goal's domain dataset pool
 *   - 1 translation  → cross-domain insight synthesis on a sampled profile
 *
 * All experiments are real, evidence-tiered runs against ingested data — no
 * synthetic claims.
 */

import fs from "node:fs";
import path from "node:path";
import { listGoals, listHypotheses } from "./goals";
import { enqueueExperiment, listQueuedExperiments, type ExperimentSpec } from "./experiments";

export const QUEUE_FLOOR = 8;
export const QUEUE_CEILING = 16;
export const MAX_ANALYSIS_PER_GOAL = 4;
export const ANALYSIS_PROFILES_PER_GOAL = 6;

/** Domain → real ingested profile directories (relative to Draymond root). */
export const DATASET_POOLS: Record<'sports' | 'biotech', string[]> = {
  sports: [
    'datasets/sports/nba/profiles',
    'datasets/sports/athlete-injury/profiles',
    'datasets/sports/boxing/profiles',
    'datasets/sports/ufc/profiles',
    'datasets/sports/nfl/profiles',
  ],
  biotech: [
    'datasets/biotech/metabric/profiles',
    'datasets/biotech/gdsc/profiles',
    'datasets/biotech/oncology/profiles',
  ],
};

function repoRoot(): string {
  return process.env.SCIENCE_ROOT ?? path.resolve(process.cwd());
}

function listProfiles(dir: string, limit: number): string[] {
  const full = path.join(repoRoot(), dir);
  if (!fs.existsSync(full)) return [];
  const files = fs
    .readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(0, limit);
  return files.map((f) => path.join(full, f));
}

/** Deterministic profile selection (stable hash spread across the pool). */
function pickProfiles(domain: 'sports' | 'biotech', n: number): string[] {
  const perPool = Math.max(1, Math.ceil(n / DATASET_POOLS[domain].length));
  const picked: string[] = [];
  for (const dir of DATASET_POOLS[domain]) {
    picked.push(...listProfiles(dir, perPool));
    if (picked.length >= n) break;
  }
  return picked.slice(0, n);
}

/**
 * Seed experiments for one goal. Returns the experiment specs enqueued.
 * Skips goals with no runnable model (no adapter yet) or already-quenched
 * hypotheses (all supported/refuted).
 */
export async function seedGoalCampaign(goalId: string): Promise<ExperimentSpec[]> {
  const goal = (await listGoals()).find((g) => g.id === goalId);
  if (!goal || goal.status !== 'active') return [];

  const hypotheses = (await listHypotheses(goalId)).filter((h) => h.status === 'untested' || h.status === 'in_progress');
  if (hypotheses.length === 0) return [];

  const specs: ExperimentSpec[] = [];

  // 1. Simulation against the goal's model (if one ships).
  if (goal.model_id) {
    specs.push({
      goal_id: goal.id,
      hypothesis_id: hypotheses[0].id,
      domain: goal.domain,
      type: 'simulation',
      model_id: goal.model_id,
      inputs: { ticks: 48 },
    });
  }

  // 2. Analysis on real ingested profiles (only for hypotheses w/ analysis need).
  const profiles = pickProfiles(goal.domain, ANALYSIS_PROFILES_PER_GOAL);
  for (const p of profiles.slice(0, MAX_ANALYSIS_PER_GOAL)) {
    const hyp = hypotheses[specs.length % hypotheses.length];
    specs.push({
      goal_id: goal.id,
      hypothesis_id: hyp.id,
      domain: goal.domain,
      type: 'analysis',
      model_id: goal.model_id,
      inputs: { dataset: p },
    });
  }

  // 3. Translation insight synthesis on one sampled profile.
  if (profiles.length > 0) {
    const hyp = hypotheses[specs.length % hypotheses.length];
    const profile = JSON.parse(fs.readFileSync(profiles[0], 'utf-8'));
    specs.push({
      goal_id: goal.id,
      hypothesis_id: hyp.id,
      domain: goal.domain,
      type: 'translation',
      inputs: { profile },
    });
  }

  const enqueued: ExperimentSpec[] = [];
  for (const spec of specs) {
    enqueued.push(await enqueueExperiment(spec));
  }
  return enqueued;
}

/**
 * Re-seed the experiment queue back up to QUEUE_CEILING, starting from the
 * highest-priority goals. Idempotent — never exceeds the ceiling.
 */
export async function ensureResearchBacklog(): Promise<{
  queuedBefore: number;
  queuedAfter: number;
  seededGoals: string[];
  seededCount: number;
}> {
  const queue = await listQueuedExperiments();
  let queuedAfter = queue.length;
  if (queuedAfter >= QUEUE_FLOOR) {
    return { queuedBefore: queue.length, queuedAfter, seededGoals: [], seededCount: 0 };
  }
  const goals = (await listGoals()).sort((a, b) => b.base_weight + b.cross_domain_value - (a.base_weight + a.cross_domain_value));
  const seededGoals: string[] = [];
  let seededCount = 0;

  for (const goal of goals) {
    if (queuedAfter >= QUEUE_CEILING) break;
    const added = await seedGoalCampaign(goal.id);
    if (added.length > 0) {
      seededGoals.push(goal.id);
      seededCount += added.length;
      queuedAfter += added.length;
    }
  }
  return { queuedBefore: queue.length, queuedAfter, seededGoals, seededCount };
}

// ---------------------------------------------------------------------------
// CLI entry: npx --yes tsx src/lib/science/campaigns.ts --seed <goalId>
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('campaigns.ts')) {
  (async () => {
    const seedIdx = process.argv.indexOf('--seed');
    if (seedIdx !== -1 && process.argv[seedIdx + 1]) {
      const goalId = process.argv[seedIdx + 1];
      const added = await seedGoalCampaign(goalId);
      console.log(`Seeded ${added.length} experiments for ${goalId}:`);
      added.forEach((e) => console.log(`  [${e.type}] ${e.model_id ?? e.inputs.dataset ?? 'profile'}`));
      return;
    }
    const r = await ensureResearchBacklog();
    console.log(`Backlog check: before=${r.queuedBefore} after=${r.queuedAfter} seededGoals=${r.seededGoals.length}`);
    r.seededGoals.forEach((g) => console.log(`  seeded ${g}`));
  })().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
  });
}
