/**
 * Repair Team — when a job fails, Draymond deploys coding/skill agents to fix it.
 *
 * Flow: detect failed jobs → classify the failure → assemble a repair crew
 * (coding agents for config/code, skill agents for skill issues) → apply a
 * known deterministic repair (config patches) or hand off to a coding agent →
 * supervised by Big Homie → outcome recorded to self-learning so lessons drive
 * future repairs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { codingStackSummary, resolveCodingTools } from "./coding-stack";

export type FailureKind = 'chain_config' | 'notification_config' | 'missing_env' | 'service_down' | 'code_error' | 'unknown';

export interface RepairCrew {
  lead: string;
  members: string[];
  reason: string;
}

export interface RepairReport {
  jobId: string;
  jobName: string;
  failureKind: FailureKind;
  error: string;
  crew: RepairCrew;
  action: 'fixed' | 'handed-off' | 'escalated';
  detail: string;
  repairedAt: string;
}

const DIR = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
const REPAIR_LOG = path.join(DIR, "repair-team-log.json");

/** Classify a scheduler job error into a repair kind. */
export function classifyFailure(error: string): FailureKind {
  const e = (error ?? "").toLowerCase();
  if (e.includes("chain_slug")) return "chain_config";
  if (e.includes("job_config.payload") || e.includes("recipient, subject")) return "notification_config";
  if (e.includes("not configured") || e.includes("requires ") && e.includes("env") || e.includes("api key")) return "missing_env";
  if (e.includes("unreachable") || e.includes("refused") || e.includes("failed to connect") || e.includes("fetch failed")) return "service_down";
  if (e.includes("error") || e.includes("exception") || e.includes("failed")) return "code_error";
  return "unknown";
}

/** Assemble the repair crew from the master coding stack. */
export function assembleCrew(kind: FailureKind): RepairCrew {
  switch (kind) {
    case "chain_config":
    case "notification_config":
    case "code_error": {
      // Definitive coding stack: codegen (Uplift Agent primary) + review
      // (RepoRank) + IDE daemon (Mutly), supervised by Big Homie.
      const codegen = resolveCodingTools("codegen");
      const review = resolveCodingTools("review");
      const ide = resolveCodingTools("ide");
      const lead = codegen[0] ?? "uplift-agent";
      const members = [
        ...codegen.slice(1),
        ...ide,
        review[0],
        "big-homie",
      ].filter((m) => m !== lead);
      return {
        lead,
        members,
        reason: `master coding stack (${codingStackSummary()}) — coding agents apply the patch, Big Homie supervises`,
      };
    }
    case "missing_env":
      return {
        lead: "uplift-agent",
        members: ["skill-vetter", "big-homie"],
        reason: "env/config gap — verify + document the required key",
      };
    case "service_down":
      return {
        lead: "overlay-auditor",
        members: ["agent-browser", "big-homie"],
        reason: "service reachability — audit + restart",
      };
    default:
      return { lead: "omniresearch-pro", members: ["megacode", "big-homie"], reason: "investigate unknown failure" };
  }
}

/**
 * Apply a known deterministic repair. Returns the report.
 * `getJobConfig`/`updateJobConfig` are injected so this module stays pure-ish
 * and testable without the DB.
 */
export async function repairFailedJob(
  job: { id: string; name: string; job_type: string; job_config: Record<string, unknown> },
  error: string,
  deps: {
    updateJobConfig: (id: string, config: Record<string, unknown>) => Promise<unknown>;
  },
): Promise<RepairReport> {
  const kind = classifyFailure(error);
  const crew = assembleCrew(kind);
  const base = { jobId: job.id, jobName: job.name, failureKind: kind, error, crew, repairedAt: new Date().toISOString() };

  // Known config fixes (deterministic, safe).
  if (kind === "chain_config" && typeof job.job_config.chain === "string") {
    const { chain, ...rest } = job.job_config;
    const config = { ...rest, chain_slug: chain };
    await deps.updateJobConfig(job.id, config);
    await recordRepair({ ...base, action: "fixed", detail: `rewrote job_config: chain -> chain_slug for job ${job.id}` });
    return { ...base, action: "fixed", detail: `rewrote job_config: chain -> chain_slug` };
  }

  if (kind === "notification_config" && typeof job.job_config.type === "string") {
    const payload = { ...(job.job_config as object) };
    const config = { payload };
    await deps.updateJobConfig(job.id, config);
    await recordRepair({ ...base, action: "fixed", detail: `wrapped job_config.type into job_config.payload` });
    return { ...base, action: "fixed", detail: `wrapped job_config into { payload: {...} }` };
  }

  if (kind === "missing_env") {
    await recordRepair({ ...base, action: "escalated", detail: `env gap — assign ${crew.lead} to provision the missing key` });
    return { ...base, action: "escalated", detail: `env gap — assign ${crew.lead} to provision the missing key` };
  }

  if (kind === "service_down") {
    await recordRepair({ ...base, action: "handed-off", detail: `handed to ${crew.lead} + ${crew.members.join(", ")} to restore the service` });
    return { ...base, action: "handed-off", detail: `handed to ${crew.lead} + ${crew.members.join(", ")}` };
  }

  await recordRepair({ ...base, action: "handed-off", detail: `handed to ${crew.lead} + ${crew.members.join(", ")} for code/skill repair` });
  return { ...base, action: "handed-off", detail: `handed to ${crew.lead} + ${crew.members.join(", ")}` };
}

async function recordRepair(report: RepairReport): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  let log: RepairReport[] = [];
  try {
    const raw = await fs.readFile(REPAIR_LOG, "utf-8");
    log = JSON.parse(raw) as RepairReport[];
  } catch { /* fresh log */ }
  log.push(report);
  await fs.writeFile(REPAIR_LOG, JSON.stringify(log.slice(-200), null, 2), "utf-8");

  // Feed self-learning with the outcome.
  try {
    const { recordOutcome } = await import('./self-learning');
    await recordOutcome({
      agentId: `repair-team:${report.crew.lead}`,
      kind: 'repair',
      summary: `${report.jobName} repair (${report.action})`,
      success: report.action === 'fixed',
      detail: report.detail,
    });
  } catch { /* best-effort */ }
}

export async function repairLog(limit = 50): Promise<RepairReport[]> {
  try {
    const raw = await fs.readFile(REPAIR_LOG, "utf-8");
    return (JSON.parse(raw) as RepairReport[]).slice(-limit);
  } catch {
    return [];
  }
}
