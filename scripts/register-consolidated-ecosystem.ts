/* Register the consolidation's new governed entities into the local registry.
   Run:     npx tsx scripts/register-consolidated-ecosystem.ts
   Dry run: npx tsx scripts/register-consolidated-ecosystem.ts --dry-run
   Idempotent (upsert by slug). Existing entities (recursive-ip, overlay-finance,
   aetherdesk, ...) are intentionally not touched — see ecosystem-consolidation.ts. */
import {
  CONSOLIDATED_ENTITIES,
  consolidationSummary,
  registerConsolidatedEcosystem,
} from '../src/lib/draymond/ecosystem-consolidation';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const summary = consolidationSummary();

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          ...summary,
          entities: CONSOLIDATED_ENTITIES.map((e) => ({
            slug: e.slug,
            kind: e.kind,
            invocation_method: e.invocation_method,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  const result = await registerConsolidatedEcosystem();
  console.log(
    JSON.stringify(
      {
        registered: result.registered,
        errors: result.errors,
        entities: CONSOLIDATED_ENTITIES.map((e) => e.slug),
      },
      null,
      2
    )
  );
  if (result.errors.length > 0) process.exitCode = 1;
}

void main();
