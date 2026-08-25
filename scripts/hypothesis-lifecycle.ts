import fs from 'node:fs';
import path from 'node:path';
import { writeBrainFile } from '../src/lib/draymond/journal';

/**
 * S11 — hypothesis lifecycle automation (weekly cron job).
 *
 * State machine (stored on each hypothesis as `lifecycle`):
 *   new -> grading -> queued -> testing -> published | archived
 *
 * Rules (deterministic, no LLM):
 *   - untested hypotheses older than STALE_DAYS without an experiment are
 *     archived-candidates (archived with reason)
 *   - untested hypotheses with a goal weight above PROMOTE_WEIGHT get queued
 *     into experiment-queue.json (dedup by hypothesis_id)
 *   - in_progress hypotheses with experiment_ids stay `testing`
 *   - every write goes through the S2 journal; kairos gets one summary moment
 */

const BRAIN_DIR = (): string =>
  process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond');

const STALE_DAYS = Number(process.env.DRAYMOND_HYP_STALE_DAYS) || 14;
const DRY_RUN = process.argv.includes('--dry-run');

interface Hypothesis {
  id: string;
  goal_id: string;
  claim: string;
  status: string;
  lifecycle?: string;
  lifecycleUpdatedAt?: string;
  experiment_ids?: string[];
  updatedAt?: string;
}

interface QueueItem {
  id: string;
  goal_id: string;
  hypothesis_id: string;
  domain: string;
  type: string;
  model_id?: string;
  inputs?: Record<string, unknown>;
  status: string;
  createdAt: string;
}

async function main() {
  const hypPath = path.join(BRAIN_DIR(), 'hypotheses.json');
  const queuePath = path.join(BRAIN_DIR(), 'experiment-queue.json');
  const goals = JSON.parse(
    fs.readFileSync(path.join(BRAIN_DIR(), 'system-goals.json'), 'utf-8')
  );
  const weightByGoal = new Map<string, number>(
    (goals.goals ?? []).map((g: { id: string; base_weight?: number }) => [g.id, g.base_weight ?? 0])
  );

  const hypDoc = JSON.parse(fs.readFileSync(hypPath, 'utf-8'));
  const queueDoc = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  const now = Date.now();
  const changes: string[] = [];
  const promoted: string[] = [];
  const archived: string[] = [];

  for (const h of hypDoc.hypotheses as Hypothesis[]) {
    if (!h.lifecycle) {
      // Backfill: map existing status to lifecycle stage.
      h.lifecycle =
        h.status === 'in_progress' ? 'testing'
        : h.status === 'untested' ? 'new'
        : 'grading';
      h.lifecycleUpdatedAt = new Date().toISOString();
      changes.push(`${h.id}: backfilled lifecycle=${h.lifecycle}`);
    }

    if (h.lifecycle === 'testing') continue;

    const hasExperiment = Array.isArray(h.experiment_ids) && h.experiment_ids.length > 0;
    const ageDays = (now - Date.parse(h.updatedAt ?? h.lifecycleUpdatedAt ?? new Date().toISOString())) / 86400000;

    if (h.lifecycle === 'new' && hasExperiment) {
      h.lifecycle = 'testing';
      h.lifecycleUpdatedAt = new Date().toISOString();
      changes.push(`${h.id}: new -> testing (has experiments)`);
      continue;
    }

    if (h.lifecycle === 'new' && ageDays > STALE_DAYS && !hasExperiment) {
      h.lifecycle = 'archived';
      h.status = 'archived';
      h.lifecycleUpdatedAt = new Date().toISOString();
      archived.push(h.id);
      changes.push(`${h.id}: new -> archived (stale ${Math.round(ageDays)}d, no experiment)`);
      continue;
    }

    if (
      h.lifecycle === 'new' &&
      (weightByGoal.get(h.goal_id) ?? 0) >= (Number(process.env.DRAYMOND_HYP_PROMOTE_WEIGHT) || 0.5)
    ) {
      const alreadyQueued = (queueDoc.queue as QueueItem[]).some((q) => q.hypothesis_id === h.id);
      if (!alreadyQueued) {
        const item: QueueItem = {
          id: crypto.randomUUID(),
          goal_id: h.goal_id,
          hypothesis_id: h.id,
          domain: h.goal_id.split('-')[0],
          type: 'analysis',
          inputs: { claim: h.claim },
          status: 'queued',
          createdAt: new Date().toISOString(),
        };
        queueDoc.queue.push(item);
        promoted.push(item.id);
        h.lifecycle = 'queued';
        h.lifecycleUpdatedAt = new Date().toISOString();
        changes.push(`${h.id}: new -> queued (goal weight ${weightByGoal.get(h.goal_id)})`);
      }
    }
  }

  console.log(`dry_run=${DRY_RUN} changes=${changes.length} promoted=${promoted.length} archived=${archived.length}`);
  for (const c of changes) console.log(`  ${c}`);

  if (DRY_RUN || changes.length === 0) return;

  // Journal-first writes via S2 journal (ownership: this is the lifecycle job).
  writeBrainFile(hypPath, JSON.stringify({ ...hypDoc, updatedAt: new Date().toISOString() }, null, 2), 'write', 'hypothesis-lifecycle');
  writeBrainFile(queuePath, JSON.stringify({ ...queueDoc, updatedAt: new Date().toISOString() }, null, 2), 'write', 'hypothesis-lifecycle');

  // One summary moment into kairos.
  try {
    const kairosPath = path.join(BRAIN_DIR(), 'kairos.json');
    const kairos = JSON.parse(fs.readFileSync(kairosPath, 'utf-8'));
    kairos.moments = kairos.moments ?? [];
    kairos.moments.push({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      kind: 'hypothesis-lifecycle',
      detail: `graded ${changes.length} hypotheses; ${promoted.length} promoted to experiment-queue, ${archived.length} archived`,
    });
    writeBrainFile(kairosPath, JSON.stringify(kairos, null, 2), 'append', 'hypothesis-lifecycle');
  } catch (err) {
    console.warn(`kairos moment skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
