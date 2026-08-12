/* One-off: replace the stale full-content-creation template with the fixed
   version from business-chains.ts (image/video steps reordered to be
   sequential, correct generate_text + schedule payloads), then re-seed so the
   scheduler picks up fresh instances on its next tick.

   Run: npx tsx scripts/sync-full-content-chain.ts
   Local SQLite DB (data/draymond.db). Idempotent. */
import { getChain } from "../src/lib/draymond/chains";
import { createDraymondAdminClient } from "../src/lib/draymond/client";
import { seedBusinessAutomation } from "../src/lib/draymond/business-chains";
import { registerEntities } from "../src/lib/draymond/registry";
import { SEED_ENTITIES } from "../src/lib/draymond/seed";

async function main(): Promise<void> {
  const db = createDraymondAdminClient();

  const existing = await getChain("full-content-creation");
  if (existing) {
    const templateId = existing.id;
    const { error: stepError } = await db
      .from("draymond_chain_steps")
      .delete()
      .eq("chain_id", templateId);
    if (stepError) throw new Error(`step delete failed: ${stepError.message}`);

    const { error: chainError } = await db
      .from("draymond_chains")
      .delete()
      .eq("id", templateId);
    if (chainError) throw new Error(`chain delete failed: ${chainError.message}`);
    console.log(`[sync] removed stale template "${existing.slug}" (${templateId}) + its steps`);
  } else {
    console.log("[sync] no existing full-content-creation template — proceeding to seed");
  }

  const result = await seedBusinessAutomation();

  // Restore the full SEED_ENTITIES endpoint maps (e.g. omni-research's
  // /api/trending-topics) which seedBusinessAutomation's leaner defs overwrite.
  // Mirrors POST /api/seed ordering.
  const entityResult = await registerEntities(SEED_ENTITIES);
  if (entityResult.errors.length > 0) {
    throw new Error(`registerEntities failed: ${entityResult.errors.join('; ')}`);
  }

  const fresh = await getChain("full-content-creation");
  const steps = fresh
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (db.from("draymond_chain_steps").select("*").eq("chain_id", fresh.id) as any).then((r: any) => r.data)
    : [];
  const plan = (steps || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((s: any) => ({ order: s.step_order, name: s.name, deps: s.depends_on_steps?.length ?? 0 }))
    .sort((a: { order: number }, b: { order: number }) => a.order - b.order);

  console.log(JSON.stringify({
    seed_errors: result.errors,
    template_created: !!fresh,
    steps: plan,
  }, null, 2));
}

main().catch((err) => {
  console.error("SYNC FAILED:", err);
  process.exit(1);
});