/* One-off runtime seed for the mission engine (mirrors POST /api/seed).
   Run: npx tsx scripts/seed-mission-runtime.ts
   Idempotent. Writes to the local SQLite DB (data/draymond.db). */
import { seedBusinessAutomation } from "../src/lib/draymond/business-chains";
import { seedAgentMonitors } from "../src/lib/draymond/monitors";
import { seedSkillPacks } from "../src/lib/draymond/skill-packs";
import { registerEntities } from "../src/lib/draymond/registry";
import { SEED_ENTITIES } from "../src/lib/draymond/seed";
import { seedChainTemplates } from "../src/lib/draymond/chains-seed";
import { seedMissionChains } from "../src/lib/draymond/mission-chains";
import { seedBasicJobs } from "../src/lib/draymond/scheduler";

async function main(): Promise<void> {
  const [biz, mon, sk, ent, chains, missionChains, jobs] = await Promise.all([
    seedBusinessAutomation(),
    seedAgentMonitors(),
    seedSkillPacks(),
    registerEntities(SEED_ENTITIES),
    seedChainTemplates(),
    seedMissionChains(),
    seedBasicJobs(),
  ]);

  console.log(
    JSON.stringify(
      {
        business: { chains: biz.chains.slugs.length, jobs: biz.jobs.names.length, errors: biz.errors.length },
        monitors: { created: mon.created, skipped: mon.skipped },
        skills: { seeded: sk.seeded },
        entities: { registered: ent.registered, errors: ent.errors.length },
        chains: { seeded: chains.seeded.length, errors: chains.errors.length },
        missionChains: { seeded: missionChains.seeded.length, errors: missionChains.errors.length },
        jobs: { created: jobs },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("SEED FAILED:", err);
  process.exit(1);
});
