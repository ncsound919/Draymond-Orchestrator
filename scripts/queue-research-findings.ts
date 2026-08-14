/**
 * Queue the research-engine-flagged weak fleet entities into Draymond's
 * upgrade queue using Draymond's own review-first queueing semantics
 * (queueWeakest + proposeActions). Nothing is auto-repaired.
 *
 * Reads the fleet-research benchmark rows pushed by the Benchmark Olympics
 * research engine and queues every entity with weakness >= 60.
 *
 * Run from Draymond-Orchestrator/: npx --yes tsx scripts/queue-research-findings.ts
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = resolve(here, '../data/draymond.db');
process.env.DRAYMOND_DB_PATH = dbFile;

async function main() {
  const { getDb } = await import('../src/lib/db/connection');
  const { queueWeakest, listUpgradeQueue, proposeActions } = await import('../src/lib/draymond/upgrade-queue');
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT run_id, component_slug, component_name, weakness_score, metrics, evidence
       FROM draymond_benchmarks
       WHERE run_id LIKE 'fleet-research-%'
       ORDER BY run_at DESC`
    )
    .all() as Array<{
    run_id: string;
    component_slug: string;
    component_name: string;
    weakness_score: number;
    metrics: string;
    evidence: string | null;
  }>;

  if (rows.length === 0) {
    console.log('No fleet-research rows found — run the Benchmark Olympics fleet-research-run.ts first.');
    return;
  }
  console.log(`Found ${rows.length} fleet-research benchmark rows (latest: ${rows[0].run_id})`);

  // Dedupe by slug (keep highest weakness).
  const bySlug = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const prev = bySlug.get(r.component_slug);
    if (!prev || r.weakness_score > prev.weakness_score) bySlug.set(r.component_slug, r);
  }

  const ranked = Array.from(bySlug.values())
    .filter((r) => r.weakness_score >= 60)
    .map((r) => {
      const metrics = JSON.parse(r.metrics || '{}') as {
        status?: string;
        reachable?: boolean;
        p99_ms?: number;
        overall_score?: number;
      };
      const reasons: string[] = [];
      if (metrics.reachable === false || metrics.status === 'Disqualified') {
        reasons.push(`live probe error: service unreachable from Benchmark Olympics fleet scan`);
      } else if (metrics.status === 'SLA Breach') {
        reasons.push(`live probe error: P99 ${metrics.p99_ms}ms exceeded SLA on fleet scan`);
      } else {
        reasons.push(`live probe error: fleet scan scored ${metrics.overall_score}/1000`);
      }
      if (r.evidence) {
        try {
          const ev = JSON.parse(r.evidence) as { insight_title?: string; tier?: string };
          if (ev.insight_title) reasons.push(`research insight (${ev.tier}): ${ev.insight_title}`);
        } catch {
          /* ignore */
        }
      }
      return {
        component_class: 'entity' as const,
        component_slug: r.component_slug,
        component_name: r.component_name,
        score: Math.min(100, r.weakness_score),
        reasons,
        trend: 'worsening' as const,
      };
    })
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    console.log('No entities above the weakness threshold (>=60) to queue.');
    return;
  }

  console.log(`Queueing ${ranked.length} research-flagged entities:`);
  ranked.forEach((w) => console.log(`  [${w.score}] entity:${w.component_slug} — ${w.component_name}`));
  ranked.forEach((w) => console.log(`      reason: ${w.reasons.join(' | ')}`));
  ranked.forEach((w) => console.log(`      action: ${proposeActions(w.component_class, w.component_slug, w.reasons)}`));

  const { queued, skipped } = await queueWeakest(ranked, 20);
  console.log(`\nqueueWeakest: queued=${queued} skipped=${skipped}`);

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
