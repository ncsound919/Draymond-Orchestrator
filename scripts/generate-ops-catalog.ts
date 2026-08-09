/* OPS catalog generator — writes OPS-CATALOG.md from the live registry.
   Run: npx tsx scripts/generate-ops-catalog.ts
   Idempotent. Reads the local SQLite DB (DRAYMOND_DB_PATH or ./data/draymond.db). */
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildOpsCatalog, renderCatalogMarkdown } from '../src/lib/draymond/ops-catalog';

async function main(): Promise<void> {
  const catalog = await buildOpsCatalog();
  const md = renderCatalogMarkdown(catalog);
  const out = path.resolve(process.cwd(), 'OPS-CATALOG.md');
  await fs.writeFile(out, md, 'utf-8');

  console.log(
    JSON.stringify(
      {
        output: out,
        totals: catalog.totals,
        total: catalog.all.length,
        categories: Object.keys(catalog.byCategory).length,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
