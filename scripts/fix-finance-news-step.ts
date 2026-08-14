/* One-off: fix Daily Finance Analysis "News Research" step — omni-research
   /api/research expects `query` as a string, but the mapping sends the symbols
   array. Join them into a query string. */
import { createDraymondAdminClient } from "../src/lib/draymond/client";

const CHAIN_SLUG = "daily-finance-analysis";

async function main() {
  const db = createDraymondAdminClient();
  const { data: chains, error: chainErr } = (await db
    .from("draymond_chains")
    .select("id")
    .eq("slug", CHAIN_SLUG)
    .eq("is_template", true)
    .limit(1)) as any;
  if (chainErr || !chains?.length) {
    console.log("chain lookup error:", chainErr?.message ?? "not found");
    process.exit(1);
  }
  const chainId = chains[0].id;

  const { data: steps, error: stepsErr } = (await db
    .from("draymond_chain_steps")
    .select("id, name, action")
    .eq("chain_id", chainId)
    .eq("name", "News Research")) as any;
  if (stepsErr || !steps?.length) {
    console.log("step lookup error:", stepsErr?.message ?? "not found");
    process.exit(1);
  }
  const step = steps[0];

  const { data, error } = (await db
    .from("draymond_chain_steps")
    .update({
      input_mapping: {
        query: "equity market news and earnings outlook",
      },
    })
    .eq("id", step.id)
    .select("id, name, input_mapping")) as any;
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
