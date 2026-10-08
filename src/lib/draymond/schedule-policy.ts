// ============================================================================
// ECOSYSTEM-ALIGNED SCHEDULE POLICY
// ============================================================================
// The ecosystem strategy model (ecosystem/strategy.md + ecosystem.manifest.json)
// is the source of truth for what deserves compute. This module is the concrete
// operational schedule derived from it: which jobs run, how often, and — for
// products whose strategy tier is degraded — whether they run at all.
//
// Applied idempotently as an OVERLAY after job seeding (bootstrap + POST
// /api/seed). It never deletes jobs; it only tunes `is_enabled` +
// `cron_expression`, so the change is reversible and auditable via git + the
// schedules UI. Jobs absent from this table are left untouched and reported as
// `unknown` (a drift surface: a new job was added without a schedule decision).
//
// Tier -> cadence policy (edit here, not in the seeders):
//   Now / Remediate / Maintain  -> active (cadence below)
//   Next                        -> active, weekly
//   Consolidate / Fix-or-Sunset / Sunset
//                               -> OFF. Daily churn on a degraded target is not
//                                  productive; the weekly Strategy Review job
//                                  surfaces these for a fix-or-sunset decision.
//
// See ecosystem/strategy.md §4 (strategy tiers) and §7 (review cadence).
// ============================================================================

export interface ScheduleRule {
  enabled: boolean;
  /** Cron expression to enforce. Kept even when disabled so re-enabling restores a sane cadence. */
  cron: string;
  /** Ecosystem project id / area this job serves (manifest id or domain). */
  project?: string;
  /** Short reason for the cadence/enablement — shown in the audit. */
  rationale: string;
}

// -- Continuous fleet ops (the heartbeat of the Remediate-grade core) --------
export const CONTINUOUS: Record<string, ScheduleRule> = {
  'Agent Health Check': { enabled: true, cron: '*/15 * * * *', project: 'CORE-10', rationale: 'continuous fleet telemetry' },
  'Agent Heartbeat Sweep': { enabled: true, cron: '*/15 * * * *', project: 'CORE-10', rationale: 'continuous agent liveness' },
  'Site Health Checks': { enabled: true, cron: '*/5 * * * *', project: 'CORE-10', rationale: 'continuous site reachability' },
  'Service Health Repair': { enabled: true, cron: '20 * * * *', project: 'CORE-10', rationale: 'hourly down-service repair' },
  'Self-Repair Check': { enabled: true, cron: '15 * * * *', project: 'CORE-10', rationale: 'hourly self-repair' },
  'Repair Team (failed jobs)': { enabled: true, cron: '5 * * * *', project: 'CORE-10', rationale: 'hourly failed-job repair loop' },
  'Kairos Scan': { enabled: true, cron: '*/15 * * * *', project: 'CORE-10', rationale: 'opportunity/risk scan' },
  'Sector Lifecycle Sweep': { enabled: true, cron: '*/10 * * * *', project: 'CORE-10', rationale: 'sector duty rotation' },
  'Fleet Duty Sync': { enabled: true, cron: '0 * * * *', project: 'CORE-10', rationale: 'hourly duty rebalance' },
  'Memory Decay Sweep': { enabled: true, cron: '0 * * * *', project: 'CORE-10', rationale: 'hourly memory hygiene' },
  'Brain Decision Cycle': { enabled: true, cron: '*/30 * * * *', project: 'CORE-21', rationale: 'core reasoning loop' },
  'Sector Productivity Persist': { enabled: true, cron: '40 23 * * *', project: 'CORE-10', rationale: 'nightly sector rollup' },
  'Pool Health Check': { enabled: true, cron: '5 5 * * *', project: 'CORE-16', rationale: 'daily model-pool health' },
  'Token Rotation Check': { enabled: true, cron: '0 11 * * *', project: 'CORE-11', rationale: 'daily credential rotation check' },
  'Free-API Key Audit': { enabled: true, cron: '0 9 * * *', project: 'CORE-16', rationale: 'daily free-key audit' },
  'CI Status Poll': { enabled: true, cron: '10 * * * *', project: 'CORE-10', rationale: 'hourly CI status for watched repos' },
};

// -- Night remediation / learning (00:00–04:59 local) -----------------------
export const NIGHT: Record<string, ScheduleRule> = {
  'Self-Learning Loop': { enabled: true, cron: '30 0 * * *', project: 'CORE-10', rationale: 'nightly lesson distillation' },
  'Self-Analysis Loop': { enabled: true, cron: '45 0 * * *', project: 'CORE-10', rationale: 'nightly self-analysis' },
  'Night Mode R&D': { enabled: true, cron: '0 1 * * *', project: 'CORE-10', rationale: 'nightly R&D plan' },
  'Dream Cycle': { enabled: true, cron: '0 2 * * *', project: 'CORE-10', rationale: 'nightly cognition' },
  'Ultraplan Process': { enabled: true, cron: '30 2 * * *', project: 'CORE-10', rationale: 'nightly ultraplan' },
  'Brain Wiki Sync': { enabled: true, cron: '0 3 * * *', project: 'CORE-21', rationale: 'nightly knowledge sync' },
  'Free Model Daily Assignment': { enabled: true, cron: '0 4 * * *', project: 'CORE-16', rationale: 'daily free-model rotation' },
  'Agent Avatar Generation': { enabled: true, cron: '0 4 * * 0', project: 'CORE-10', rationale: 'weekly optional avatars (Sunday)' },
  'Benchmark: Entities': { enabled: true, cron: '0 6 * * 1', project: 'CORE-10', rationale: 'weekly benchmark (Mon)' },
  'Benchmark: Sites': { enabled: true, cron: '0 7 * * 1', project: 'CORE-10', rationale: 'weekly benchmark (Mon)' },
  'Benchmark: Crons': { enabled: true, cron: '0 6 * * 2', project: 'CORE-10', rationale: 'weekly benchmark (Tue)' },
  'Benchmark: Chains': { enabled: true, cron: '0 6 * * 3', project: 'CORE-10', rationale: 'weekly benchmark (Wed)' },
  'Benchmark: Deep Score': { enabled: true, cron: '0 6 * * 4', project: 'CORE-10', rationale: 'weekly deep score (Thu)' },
  'Benchmark: Upgrade Review': { enabled: true, cron: '0 7 * * 5', project: 'CORE-10', rationale: 'weekly upgrade review (Fri)' },
  'Benchmark: Sync Roster': { enabled: true, cron: '0 8 * * 5', project: 'CORE-10', rationale: 'weekly roster sync (Fri)' },
  'Roster Benchmark': { enabled: true, cron: '30 6 * * *', project: 'CORE-10', rationale: 'daily roster benchmark' },
  'Weekend Ops Review': { enabled: true, cron: '0 8 * * 6', project: 'CORE-10', rationale: 'weekend upgrade review' },
  'Benchmark Olympics Discovery Loop': { enabled: true, cron: '0 */6 * * *', project: 'CORE-10', rationale: '6-hourly discovery loop' },
  'Daily Repair Shift': { enabled: true, cron: '0 18 * * *', project: 'CORE-10', rationale: 'daily fleet repair shift' },
  'Weekend Self-Repair Deep Dive': { enabled: true, cron: '0 9 * * 6', project: 'CORE-10', rationale: 'weekend deep repair' },
  'On-Device Ops Dispatch': { enabled: true, cron: '45 9 * * *', project: 'CORE-10', rationale: 'daily on-device ops' },
  'Secret Scan': { enabled: true, cron: '15 6 * * 1', project: 'CORE-11', rationale: 'weekly secret scan of the working tree (Mon)' },
  'Backup Verify': { enabled: true, cron: '30 7 * * *', project: 'CORE-10', rationale: 'daily backup snapshot integrity check' },
};

// -- Morning: Now-tier work (05:00–08:59) -----------------------------------
export const MORNING: Record<string, ScheduleRule> = {
  'Research Rotation': { enabled: true, cron: '0 6 * * *', project: 'CORE-20', rationale: 'Now: OmniResearch rotation' },
  'Research Data Feed': { enabled: true, cron: '0 7 * * 1', project: 'CORE-20', rationale: 'weekly (kaggle creds/feed gap tracked)' },
  'Cancer Research Deep-Dive': { enabled: true, cron: '0 5 * * *', project: 'SCI-01', rationale: 'Now: Overlay Oncology' },
  'Oncology Night Shift': { enabled: true, cron: '0 22 * * *', project: 'SCI-01', rationale: 'Now: Overlay Oncology' },
  'Oncology Revalidation (nightly)': { enabled: true, cron: '0 3 * * *', project: 'SCI-01', rationale: 'Now: oncology revalidation (canonical)' },
  'Oncology Revalidation': { enabled: false, cron: '0 2 * * *', project: 'SCI-01', rationale: 'duplicate of (nightly) — deduped' },
  'ClinVar Variant Surveillance': { enabled: true, cron: '0 8 * * *', project: 'SCI-02', rationale: 'Consolidate: keep nightly surveillance' },
  'Science Paper Refresh': { enabled: true, cron: '0 3 * * 1', project: 'SCI-18', rationale: 'weekly paper refresh (Mon)' },
  'Science Publication Loop': { enabled: true, cron: '10 3 * * *', project: 'SCI-18', rationale: 'Now: research-orchestrator' },
  'Science Campaign Seed': { enabled: true, cron: '0 16 * * *', project: 'SCI-18', rationale: 'Now: science backlog' },
  'Research Breakthrough Grading': { enabled: true, cron: '30 18 * * *', project: 'SCI-18', rationale: 'Now: research grading' },
  'Synthesis Midday': { enabled: true, cron: '0 12 * * *', project: 'CORE-20', rationale: 'midday synthesis' },
  'News Digest': { enabled: true, cron: '0 6 * * *', project: 'CRE-03', rationale: 'daily news ingest' },
  'News Outlet Ingest': { enabled: true, cron: '45 2 * * 1,5', project: 'CRE-03', rationale: 'Now: Global Lens (Mon/Fri)' },
  'Market News Digest': { enabled: true, cron: '0 7 * * *', project: 'CORE-10', rationale: 'daily news digest' },
  'GitHub Awesome Weekly Scan': { enabled: true, cron: '0 6 * * 0', project: 'INT-25', rationale: 'weekly tooling scan (Sun)' },
  'Treasurer Cash Pulse': { enabled: true, cron: '0 8 * * *', project: 'FIN-01', rationale: 'Now: finance state' },
  'Finance Strategy Brief': { enabled: true, cron: '15 8 * * *', project: 'FIN-01', rationale: 'Now: finance planning' },
  'Finance Goals Sync': { enabled: true, cron: '45 8 * * *', project: 'FIN-01', rationale: 'Now: finance goals' },
  'Editorial Morning Push': { enabled: true, cron: '0 7 * * *', project: 'CRE-03', rationale: 'daily editorial comms' },
  'Daily Health Digest': { enabled: true, cron: '0 20 * * *', project: 'CORE-10', rationale: 'daily health digest' },
  'Morning Recap (email)': { enabled: true, cron: '5 8 * * *', project: 'CORE-10', rationale: 'phase recap' },
  'Midday Recap (email)': { enabled: true, cron: '5 12 * * *', project: 'CORE-10', rationale: 'phase recap' },
  'Evening Recap (email)': { enabled: true, cron: '5 20 * * *', project: 'CORE-10', rationale: 'phase recap' },
  'Night Recap (email)': { enabled: true, cron: '5 0 * * *', project: 'CORE-10', rationale: 'phase recap' },
  'Systemic Interconnect': { enabled: true, cron: '0 5 * * 0', project: 'CORE-10', rationale: 'weekly systemic interconnect (Sun)' },
  'Systemic Consolidate': { enabled: true, cron: '30 5 * * *', project: 'CORE-10', rationale: 'daily graph consolidation' },
};

// -- Business-hours: Now/Next product work ----------------------------------
export const BUSINESS: Record<string, ScheduleRule> = {
  'Mission Pipeline Sync': { enabled: true, cron: '0 6 * * *', project: 'APP-02', rationale: 'Now: mission pipeline' },
  'Mission Strategy Review': { enabled: true, cron: '0 8 * * 1', project: 'APP-02', rationale: 'weekly strategy review (Mon)' },
  'Mission Workflow Sync': { enabled: true, cron: '30 9 * * *', project: 'APP-02', rationale: 'daily workflow sync' },
  'Staffing Commission Payout': { enabled: true, cron: '0 9 * * 5', project: 'APP-02', rationale: 'Now: Staffing-Commission-Engine (Fri)' },
  'Staffing Commission Monthly Reset': { enabled: true, cron: '5 0 1 * *', project: 'APP-02', rationale: 'monthly commission reset' },
  'Pilot-Partner Outreach Tick': { enabled: true, cron: '30 9 * * 1', project: 'INT-04', rationale: 'weekly partner outreach (Mon)' },
  'Pilot-Partner Outreach Tick (daily)': { enabled: false, cron: '0 9 * * *', project: 'INT-04', rationale: 'duplicate of the weekly tick — deduped' },
  'Fleet Health Check': { enabled: true, cron: '0 8 * * *', project: 'CORE-10', rationale: 'daily fleet health' },
  'Overlay365 QA': { enabled: true, cron: '0 7 * * *', project: 'PLAT-01', rationale: 'daily platform QA' },
};

// -- Weekly strategy review (strategy.md §7) — regenerates the model --------
export const STRATEGY: Record<string, ScheduleRule> = {
  'Weekly Strategy Review': { enabled: true, cron: '0 6 * * 1', project: 'CORE-00', rationale: 'regenerate manifest/priority + surface tier churn (Mon)' },
};

// -- Degraded-tier product lines: OFF until their tier promotes -------------
// Rationale for each: the target project is Consolidate / Fix-or-Sunset /
// Sunset (strategy.md §4) or was replaced (bookbridge -> Synthbook). Running
// daily product pipelines on these is not productive; the weekly Strategy
// Review job surfaces them for a fix-or-sunset decision instead.
export const GATED_OFF: Record<string, ScheduleRule> = {
  // Books — bookbridge retired, replaced by Synthbook (no cron until ingest is wired)
  'Book-Grounded Research': { enabled: false, cron: '0 5 * * *', project: 'WRI-01', rationale: 'bookbridge retired -> Synthbook; repoint before re-enabling' },
  'Daily Book Library Scan': { enabled: false, cron: '0 3 * * *', project: 'WRI-01', rationale: 'bookbridge retired -> Synthbook; repoint before re-enabling' },
  // Marketing / social — oss-marketing-stack = Fix or Sunset
  'Marketing Pulse': { enabled: false, cron: '0 10 * * *', project: 'INT-02', rationale: 'oss-marketing-stack = Fix or Sunset' },
  'Marketing Strategy Pass': { enabled: false, cron: '0 7 * * 1', project: 'INT-02', rationale: 'oss-marketing-stack = Fix or Sunset' },
  'Daily Marketing Run': { enabled: false, cron: '0 10 * * *', project: 'INT-02', rationale: 'oss-marketing-stack = Fix or Sunset' },
  'Evening Marketing Prep': { enabled: false, cron: '0 20 * * *', project: 'INT-02', rationale: 'oss-marketing-stack = Fix or Sunset' },
  'Full Content Creation': { enabled: false, cron: '0 14 * * 1,3,5', project: 'INT-22', rationale: 'Content-Creation-Engine = Next (not yet)' },
  'OSS Marketing Stack Up': { enabled: false, cron: '0 8 * * *', project: 'INT-02', rationale: 'oss-marketing-stack = Fix or Sunset' },
  'OSS Marketing Stack Status': { enabled: false, cron: '30 22 * * *', project: 'INT-02', rationale: 'oss-marketing-stack = Fix or Sunset' },
  'Social Publish Drainer': { enabled: false, cron: '*/30 * * * *', project: 'INT-02', rationale: 'targets a Fix-or-Sunset stack' },
  // Finance trading / market churn (Now finance targets are the integrations, not the trading line)
  'Daily Finance Analysis': { enabled: false, cron: '30 9 * * 1-5', project: 'FIN-01', rationale: 'trading line not Now; finance Now = ERPNext/finance-connect/actual-budget' },
  'Market Data Snapshot': { enabled: false, cron: '0 7 * * *', project: 'FIN-01', rationale: 'market snapshot not tied to a Now project' },
  'Morning Briefing': { enabled: false, cron: '0 9 * * *', project: 'FIN-01', rationale: 'trading/sports briefing; paused with the trading line' },
  // Unprovisioned backends (no checkout/service on this box — re-enable when provisioned)
  'IP Portfolio Grading': { enabled: false, cron: '0 9 * * 1', project: 'FIN-06', rationale: 'recursive-ip + uplift-agent unprovisioned locally' },
  'Deep Research Weekly': { enabled: false, cron: '30 9 * * 1', project: 'CORE-20', rationale: 'mutly retired + uplift-agent unprovisioned; chain cannot complete' },
  'MaaS Monthly Cycle': { enabled: false, cron: '0 9 * * 1', project: 'APP-02', rationale: 'mutly retired + uplift-agent unprovisioned; chain cannot complete' },
  'Hemp Research & News Digest': { enabled: false, cron: '0 7 * * *', project: 'HEMP-01', rationale: 'hemp-os/hempforge backends not provisioned locally' },
  // Sports — Consolidate / Later
  'NBA Stats Ingest': { enabled: false, cron: '30 4 * * *', project: 'SCI-27', rationale: 'Sports tools = Consolidate' },
  'Sports Bankroll Pulse': { enabled: false, cron: '15 8 * * *', project: 'SCI-27', rationale: 'Sports tools = Consolidate' },
  // Music — Later
  'Music Shift': { enabled: false, cron: '30 3 * * *', project: 'MUS-02', rationale: 'soundlab = Next; sovereign/NCSOUND = Later' },
  // Call center — Aetherdesk = Fix or Sunset
  'Evening Call Recap': { enabled: false, cron: '30 20 * * *', project: 'INT-01', rationale: 'Aetherdesk = Fix or Sunset' },
};

export const JOB_SCHEDULE: Record<string, ScheduleRule> = {
  ...CONTINUOUS,
  ...NIGHT,
  ...MORNING,
  ...BUSINESS,
  ...STRATEGY,
  ...GATED_OFF,
};

export interface PolicyInputJob {
  id: string;
  name: string;
  cron_expression: string;
  is_enabled: boolean;
  /** NULL next_run_at on an enabled job means it can never be claimed (`.lte` skips nulls). */
  next_run_at?: string | null;
}

export interface PolicyChange {
  id: string;
  name: string;
  from: { enabled: boolean; cron: string };
  to: { enabled: boolean; cron: string };
  rationale: string;
}

/** Pure diff: which jobs need a change to match the policy, and which enabled
 *  jobs have no rule (drift — a job was added without a schedule decision). */
export function diffSchedulePolicy(jobs: PolicyInputJob[]): { changes: PolicyChange[]; unknown: string[] } {
  const changes: PolicyChange[] = [];
  const unknown: string[] = [];
  for (const job of jobs) {
    const rule = JOB_SCHEDULE[job.name];
    if (!rule) {
      if (job.is_enabled) unknown.push(job.name);
      continue;
    }
    if (job.is_enabled !== rule.enabled || job.cron_expression !== rule.cron) {
      changes.push({
        id: job.id,
        name: job.name,
        from: { enabled: job.is_enabled, cron: job.cron_expression },
        to: { enabled: rule.enabled, cron: rule.cron },
        rationale: rule.rationale,
      });
    }
  }
  return { changes, unknown };
}

/** Apply the policy overlay. Idempotent; never deletes jobs. */
export async function applySchedulePolicy(): Promise<{ updated: string[]; unchanged: number; unknown: string[]; healed: string[] }> {
  const { listJobs, updateJob } = await import('./scheduler');
  const jobs = await listJobs();
  const input: PolicyInputJob[] = jobs.map((j) => ({
    id: j.id,
    name: j.name,
    cron_expression: j.cron_expression,
    is_enabled: j.is_enabled,
    next_run_at: j.next_run_at,
  }));
  const { changes, unknown } = diffSchedulePolicy(input);

  const updated: string[] = [];
  for (const change of changes) {
    try {
      await updateJob(change.id, { is_enabled: change.to.enabled, cron_expression: change.to.cron });
      updated.push(change.name);
    } catch (err) {
      console.error(`[schedule-policy] failed to update "${change.name}":`, err instanceof Error ? err.message : err);
    }
  }

  // Heal: an enabled job with next_run_at = NULL never matches the claim query
  // (`.lte('next_run_at', now)` skips nulls), so it silently never fires — and
  // the enabled/cron diff above can't see it. Recompute from its own cron.
  const healed: string[] = [];
  for (const job of input) {
    // Skip jobs just retuned above — updateJob already recomputed their next_run_at.
    if (job.is_enabled && !job.next_run_at && job.cron_expression && !updated.includes(job.name)) {
      try {
        await updateJob(job.id, { cron_expression: job.cron_expression });
        healed.push(job.name);
      } catch (err) {
        console.error(`[schedule-policy] failed to heal next_run_at for "${job.name}":`, err instanceof Error ? err.message : err);
      }
    }
  }

  return { updated, unchanged: jobs.length - changes.length, unknown, healed };
}

