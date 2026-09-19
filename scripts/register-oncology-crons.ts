/**
 * Register the oncology scheduled jobs from plans/oncology-cron-jobs.json.
 *
 * SAFETY: dry-run by default. `--apply` actually writes to the Supabase
 * `draymond_scheduled_jobs` table — operator confirmation required before
 * running (AGENTS.md guardrail: do not activate fleet without the operator).
 *
 * Run from Draymond-Orchestrator/:
 *   npx tsx scripts/register-oncology-crons.ts            # dry-run
 *   npx tsx scripts/register-oncology-crons.ts --apply    # WRITES
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ScheduledJobInsert } from '../src/lib/draymond/scheduler';

interface CronManifest {
  meta?: Record<string, unknown>;
  jobs: ScheduledJobInsert[];
}

const UPLIFT_ROOT = process.env.UPLIFT_ROOT ?? resolve(process.cwd(), '..');
const MANIFEST_PATH = resolve(UPLIFT_ROOT, 'plans', 'oncology-cron-jobs.json');

function loadManifest(): CronManifest {
  const raw = readFileSync(MANIFEST_PATH, 'utf-8');
  return JSON.parse(raw) as CronManifest;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const manifest = loadManifest();
  const jobs = manifest.jobs ?? [];

  console.log(`[register-oncology-crons] manifest=${MANIFEST_PATH}`);
  console.log(`[register-oncology-crons] mode=${apply ? 'APPLY (writes Supabase)' : 'DRY-RUN (no writes)'}`);
  console.log(`[register-oncology-crons] ${jobs.length} jobs in manifest\n`);

  if (apply) {
    const { createJob, listJobs } = await import('../src/lib/draymond/scheduler');
    const existing = await listJobs({ limit: 500 });
    const existingNames = new Set(existing.map((j) => j.name));
    let created = 0;
    let skipped = 0;
    for (const job of jobs) {
      if (existingNames.has(job.name)) {
        console.log(`  SKIP  ${job.name} (already exists)`);
        skipped += 1;
        continue;
      }
      if (!job.is_enabled) {
        console.log(`  SKIP  ${job.name} (disabled in manifest — handler/chain not provisioned)`);
        skipped += 1;
        continue;
      }
      const record = await createJob(job);
      console.log(`  CREATE ${job.name} (${record.id}) cron="${job.cron_expression}" handler=${JSON.stringify(job.job_config?.handler)}`);
      created += 1;
    }
    console.log(`\n[register-oncology-crons] done: ${created} created, ${skipped} skipped`);
  } else {
    for (const job of jobs) {
      const state = job.is_enabled ? 'ENABLED' : 'DISABLED';
      console.log(`  [${state}] ${job.name}`);
      console.log(`         cron=${job.cron_expression} type=${job.job_type} handler=${JSON.stringify(job.job_config?.handler)}`);
    }
    console.log('\n[register-oncology-crons] dry-run only. Re-run with --apply (operator confirmation required) to write Supabase draymond_scheduled_jobs.');
  }
}

main().catch((err) => {
  console.error('[register-oncology-crons] FAILED', err);
  process.exit(1);
});