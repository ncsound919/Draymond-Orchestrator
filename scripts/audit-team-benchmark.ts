/**
 * Audit-team focused benchmark cycle: scores the audit team components
 * (overlay-auditor entity, audit-delivery chain, free-api-key-audit cron)
 * using the standard trends engine (collect -> trend -> weakness -> queue).
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
process.env.DRAYMOND_DB_PATH = resolve(here, '../data/draymond.db');

async function main() {
  const { runBenchmarkCycle } = await import('../src/lib/draymond/run-benchmark');
  const { getTrend } = await import('../src/lib/draymond/benchmarking');

  const targets = [
    { cls: 'entity' as const, slugs: ['overlay-auditor'] },
    { cls: 'chain' as const, slugs: ['audit-delivery'] },
    { cls: 'cron' as const, slugs: ['free-api-key-audit'] },
  ];

  for (const t of targets) {
    console.log(`\n=== ${t.cls} cycle ===`);
    try {
      const r = await runBenchmarkCycle(t.cls, { queueLimit: 5 });
      console.log(
        `measured=${r.measured} recorded=${r.recorded} queued=${r.queued} deepScored=${r.deepScored}`
      );
      console.log(`weakest: ${r.weakest.map((w) => `${w.slug}:${w.score}`).join(', ')}`);
      for (const slug of t.slugs) {
        const trend = await getTrend(t.cls, slug);
        console.log(`  trend ${t.cls}:${slug} = [${trend.join(', ')}]`);
      }
    } catch (e) {
      console.error(`cycle failed for ${t.cls}:`, e instanceof Error ? e.message : e);
    }
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
