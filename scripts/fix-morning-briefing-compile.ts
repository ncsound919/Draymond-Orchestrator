/* One-off: fix Morning Briefing "Compile Briefing" step — uplift-agent /task
   requires `description`, not `task`. */
import { createDraymondAdminClient } from "../src/lib/draymond/client";

const STEP_ID = "d9676c4b-5c34-4a97-88c8-93edab7490d0";

async function main() {
  const db = createDraymondAdminClient();
  const { data, error } = (await db
    .from("draymond_chain_steps")
    .update({
      input_mapping: {
        description: "compile_morning_briefing",
        finance: "$.steps.finance_summary.output",
        sports: "$.steps.sports_picks.output",
        supply_chain: "$.steps.sc_alerts.output",
      },
    })
    .eq("id", STEP_ID)
    .select("id, name, action, input_mapping")) as any;
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
