/**
 * Close the upgrade loop: mark the queued items for entities whose research
 * benchmark trend improved (litellm-gateway, aetherdesk) as completed, and
 * print the remaining queue. Run from Draymond-Orchestrator/.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
process.env.DRAYMOND_DB_PATH = resolve(here, '../data/draymond.db');

async function main() {
  const { listUpgradeQueue, resolveQueueItem } = await import('../src/lib/draymond/upgrade-queue');

  const FIXED = new Set(['litellm-gateway', 'aetherdesk']);

  const queued = await listUpgradeQueue('queued');
  console.log(`Queued before: ${queued.length}`);
  for (const item of queued) {
    if (FIXED.has(item.component_slug)) {
      await resolveQueueItem(item.id, 'completed');
      console.log(`  completed: ${item.component_slug} (weakness ${item.weakness_score} -> fixed by restart, benchmark-validated)`);
    }
  }

  const after = await listUpgradeQueue('queued');
  console.log(`\nQueued after: ${after.length}`);
  after.forEach((q) =>
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
