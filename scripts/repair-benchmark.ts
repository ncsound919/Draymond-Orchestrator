/**
 * CLI twin of POST /api/ops/repair-benchmark: dispatch the Draymond repair
 * team on weak benchmark components without needing the server on :3444.
 *
 * Usage:
 *   npx tsx scripts/repair-benchmark.ts '<json-array-of-rows>'
 *   npx tsx scripts/repair-benchmark.ts --file rows.json
 *
 * Row shape (same as the HTTP route):
 *   { component_slug, component_name?, weakness_score, reasons?,
 *     proposed_action?, repo_url? }
 */
import { resolve, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
process.env.DRAYMOND_DB_PATH = resolve(here, '../data/draymond.db');

interface Row {
  component_slug?: unknown;
  component_name?: unknown;
  weakness_score?: unknown;
  reasons?: unknown;
  proposed_action?: unknown;
  repo_url?: unknown;
}

function loadRows(): Row[] {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: npx tsx scripts/repair-benchmark.ts \'<json-array>\' | --file <path>');
    process.exit(1);
  }
  const raw = arg === '--file' ? readFileSync(resolve(process.cwd(), process.argv[3] ?? ''), 'utf8') : arg;
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed.rows) ? parsed.rows : [];
}

async function main() {
  const rows = loadRows()
    .filter(
      (r) =>
        r &&
        typeof r.component_slug === 'string' &&
        r.component_slug.trim().length > 0 &&
        typeof r.weakness_score === 'number' &&
        Number.isFinite(r.weakness_score) &&
        r.weakness_score >= 0
    )
    .slice(0, 5)
    .map((r) => ({
      component_slug: r.component_slug as string,
      component_name: typeof r.component_name === 'string' ? r.component_name : (r.component_slug as string),
      weakness_score: r.weakness_score as number,
      reasons: Array.isArray(r.reasons) ? (r.reasons as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
      proposed_action: typeof r.proposed_action === 'string' ? r.proposed_action : undefined,
      repo_url: typeof r.repo_url === 'string' ? r.repo_url : null,
    }));

  if (rows.length === 0) {
    console.error('no valid benchmark weakness rows');
    process.exit(1);
  }

  const { repairWeakEntity } = await import('../src/lib/draymond/repair-team');
  for (const row of rows) {
    try {
      const report = await repairWeakEntity(row);
      console.log(
        `${row.component_slug} score=${row.weakness_score} action=${report.action}${report.detail ? ` detail=${report.detail}` : ''}`
      );
    } catch (err) {
      console.error('%s FAILED:', row.component_slug, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
