/* Verify the mission engine runtime state in the SQLite DB.
   Run: npx tsx scripts/verify-mission-runtime.ts */
import Database from "better-sqlite3";

const db = new Database("data/draymond.db", { readonly: true });

const chains = db
  .prepare("SELECT slug, name, is_template, status FROM draymond_chains WHERE slug IN ('maas-monthly-cycle','audit-delivery','research-brief-delivery')")
  .all();
const jobs = db
  .prepare("SELECT name, cron_expression, job_type, is_enabled FROM draymond_scheduled_jobs WHERE name LIKE 'Mission%' OR name LIKE 'MaaS%'")
  .all();
const ents = db
  .prepare("SELECT slug, invocation_method FROM draymond_entities WHERE slug IN ('uplift-agent','grader','reporank','mutly','omni-research','social-media-dashboard','kaggle')")
  .all();
const steps = db
  .prepare("SELECT c.slug, count(s.id) AS step_count FROM draymond_chains c LEFT JOIN draymond_chain_steps s ON s.chain_id = c.id WHERE c.slug IN ('maas-monthly-cycle','audit-delivery','research-brief-delivery') GROUP BY c.slug")
  .all();

console.log("CHAINS:", JSON.stringify(chains, null, 2));
console.log("STEP COUNTS:", JSON.stringify(steps));
console.log("MISSION JOBS:", JSON.stringify(jobs, null, 2));
console.log("ENTITIES:", JSON.stringify(ents, null, 2));

db.close();
