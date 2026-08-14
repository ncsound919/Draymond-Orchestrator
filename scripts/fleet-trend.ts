/**
 * Dump the research-driven benchmark trend for the upgraded fleet entities.
 * Run from Draymond-Orchestrator/: npx --yes tsx scripts/fleet-trend.ts
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
process.env.DRAYMOND_DB_PATH = resolve(here, '../data/draymond.db');

async function main() {
  const { getDb } = await import('../src/lib/db/connection');
  const db = getDb();
  const slugs = ['litellm-gateway', 'aetherdesk', 'ghostfolio-engine', 'phoenix', 'stirling-pdf'];

  const rows = db
    .prepare(
      `SELECT run_id, component_slug, component_name, weakness_score, metrics, run_at
       FROM draymond_benchmarks
       WHERE run_id LIKE 'fleet-research-%'
       ORDER BY run_at ASC`
    )
    .all() as Array<{
    run_id: string;
    component_slug: string;
    component_name: string;
    weakness_score: number;
    metrics: string;
    run_at: string;
  }>;

  for (const slug of slugs) {
    console.log(`\n=== ${slug} ===`);
    rows
      .filter((r) => r.component_slug === slug)
      .forEach((r) => {
        const m = JSON.parse(r.metrics || '{}') as { p99_ms?: number; status?: string; overall_score?: number };
        console.log(
          `  ${r.run_at.slice(0, 19)}  ${r.run_id.slice(-4)}  weak=${String(r.weakness_score).padStart(3)}  ` +
            `p99=${String(m.p99_ms).padStart(7)}ms  ${m.status}  score=${m.overall_score}`
        );
      });
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
