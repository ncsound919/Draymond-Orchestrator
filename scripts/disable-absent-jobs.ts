/* One-off: disable scheduled jobs whose backing service is not provisioned
   on this machine, so the scheduler stops hammering failures that can never
   succeed. Rationale mirrors `disableAbsentServiceMonitors`.

     sports-betting-daily    -> needs bet-buddy (no node_modules/package.json)
     music-business-automation -> needs indy-music-platform (repo absent)

   Run: npx tsx scripts/disable-absent-jobs.ts
   NOTE: a subsequent /api/seed re-enables them (JOB_DEFS upsert sets
   is_enabled:true). */
import { createDraymondAdminClient } from "../src/lib/draymond/client";

const TO_DISABLE = ["Sports Betting Daily", "Music Business Automation"];

async function main(): Promise<void> {
  const db = createDraymondAdminClient();
  for (const name of TO_DISABLE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = (await db.from("draymond_scheduled_jobs").update({ is_enabled: false }).eq("name", name).select("name, is_enabled")) as any;
    if (error) {
      console.log(`${name}: ERROR ${error.message}`);
      continue;
    }
    console.log(`${name}: ${data?.length ? `disabled (${data.length})` : "not found"}`);
  }
}

main().catch((err) => {
  console.error("DISABLE FAILED:", err);
  process.exit(1);
});