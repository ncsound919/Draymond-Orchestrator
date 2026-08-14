/**
 * Run Draymond's entity benchmark cycle to queue the weakest real fleet
 * components for upgrade (review-first — nothing is auto-repaired).
 *
 * Reads the same SQLite DB as the running Draymond server and records a fresh
 * benchmark run + populates draymond_upgrade_queue with proposed actions.
 *
 * Run from Draymond-Orchestrator/: npx --yes tsx scripts/run-entity-benchmark.ts
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = resolve(here, '../data/draymond.db');
process.env.DRAYMOND_DB_PATH = dbFile;

async function main() {
  const { runBenchmarkCycle } = await import('../src/lib/draymond/run-benchmark');
  const { listUpgradeQueue } = await import('../src/lib/draymond/upgrade-queue');

  console.log(`DB: ${dbFile}`);
  console.log('Running entity benchmark cycle (queueLimit=5)...');
  const r = await runBenchmarkCycle('entity', { queueLimit: 5 });
  console.log(
    `cycle: class=${r.componentClass} measured=${r.measured} recorded=${r.recorded} ` +
      `weakest=${r.weakest.map((w) => `${w.slug}:${w.score}`).join(', ')} queued=${r.queued} deepScored=${r.deepScored}`
  );

  const queue = await listUpgradeQueue('queued');
  console.log(`\nUpgrade queue (queued): ${queue.length} items`);
  queue.forEach((q) =>
    console.log(
      `  [${q.weakness_score}] ${q.component_class}:${q.component_slug} — ${q.component_name}\n` +
        `      reasons: ${(q.reasons ?? []).join(' | ')}\n` +
        `      action:  ${q.proposed_action}`
    )
  );
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
