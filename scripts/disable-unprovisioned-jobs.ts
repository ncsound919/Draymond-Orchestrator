/* Disable scheduled jobs whose backing services are not provisioned on this
   machine, so the scheduler stops hammering failures that can never succeed.
   Mirrors the `is_enabled: false` seed in business-chains.ts JOB_DEFS.

     sports-betting-daily      -> bet-buddy (no checkout/deps)
     music-business-automation -> indy-music-platform (no deps)
     supply-chain-intelligence -> overlay-chain (no deps)
     hemp-research-news        -> hemp-os + hempforge (no checkouts)
     research-data-pipeline    -> kaggle service (absent)

   Run: npx tsx scripts/disable-unprovisioned-jobs.ts */
import { createDraymondAdminClient } from "../src/lib/draymond/client";

const TO_DISABLE = [
  "Sports Betting Daily",
  "Music Business Automation",
  "Supply Chain Intelligence",
  "Hemp Research & News Digest",
  "Research Data Feed",
];

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
