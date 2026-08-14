/* One-off: repoint Morning Briefing "Supply Chain Alerts" step at omni-research
   (overlay-chain has no local checkout and can never run here). */
import { createDraymondAdminClient } from "../src/lib/draymond/client";

const STEP_ID = "ede0ae9d-cdf1-4ab1-8a6d-904b52d6cd15";
const OMNI_ID = "3b9146b1-96ab-4677-9eff-ac02da6c23bf";

async function main() {
  const db = createDraymondAdminClient();
  const { data, error } = (await db
    .from("draymond_chain_steps")
    .update({
      entity_id: OMNI_ID,
      action: "research_news",
      input_mapping: { query: "supply chain risk and disruption update" },
    })
    .eq("id", STEP_ID)
    .select("id, name, entity_id, action, input_mapping")) as any;
  if (error) {
    console.log("PATCH ERROR:", error.message);
    process.exit(1);
  }
  console.log("patched:", JSON.stringify(data));
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
