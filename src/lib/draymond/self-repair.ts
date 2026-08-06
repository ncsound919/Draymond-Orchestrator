/**
 * Self-repair — detect failure signals and attempt automated recovery.
 *
 * Uses Draymond's monitors + the QA tool as failure signals, then applies a
 * known repair action (restart a service, re-run a job, clear a cache). Every
 * attempt is logged and fed to self-learning. Deterministic: only safe, known
 * repairs run automatically; unknown failures escalate to on-call.
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface RepairAction {
  /** e.g. "restart:overlay-auditor", "reseed:registry" */
  name: string;
  service: string;
  command: string[];
  safe: boolean;
}

export interface RepairAttempt {
  id: string;
  detectedAt: string;
  signal: string;
  action: RepairAction;
  status: "applied" | "escalated" | "skipped";
  detail: string;
}

/** Known safe repairs keyed by failure signal (service + check). */
const REPAIR_MAP: Record<string, RepairAction> = {
  "monitor:down": {
    name: "restart:service", service: "unknown", command: [], safe: false, // escalated — no blind restart
  },
  "qa:fail": {
    name: "reindex:qa", service: "agent-browser", command: ["npx", "tsx", "agents/AgentBrowser-main/scripts/run-site-tests.ts", "all"], safe: true,
  },
  "job:error": {
    name: "retry:job", service: "draymond-scheduler", command: [], safe: true,
  },
  "registry:stale": {
    name: "reseed:registry", service: "draymond", command: ["node", "scripts/seed-agents.mjs"], safe: true,
  },
};

const DIR = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
const LOG_FILE = path.join(DIR, "repair-log.json");

async function readLog(): Promise<RepairAttempt[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf-8");
    return JSON.parse(raw) as RepairAttempt[];
  } catch {
    return [];
  }
}

async function appendLog(attempt: RepairAttempt): Promise<void> {
  const log = await readLog();
  log.push(attempt);
  await fs.writeFile(LOG_FILE, JSON.stringify(log.slice(-200), null, 2), "utf-8");
}

/** Run a repair action. Only `safe` actions are executed. */
export async function attemptRepair(signal: string, detail: string): Promise<RepairAttempt> {
  const action = REPAIR_MAP[signal];
  const attempt: RepairAttempt = {
    id: `rp_${Date.now()}`,
    detectedAt: new Date().toISOString(),
    signal,
    action: action ?? { name: "escalate", service: "unknown", command: [], safe: false },
    status: "escalated",
    detail,
  };

  if (!action) {
    attempt.status = "escalated";
    attempt.detail = `No known repair for "${signal}" — ${detail} (on-call).`;
    await appendLog(attempt);
    return attempt;
  }

  if (!action.safe || action.command.length === 0) {
    attempt.status = "escalated";
    attempt.detail = `Repair "${action.name}" not safe to auto-run — ${detail} (on-call).`;
    await appendLog(attempt);
    return attempt;
  }

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)(action.command[0], action.command.slice(1), { timeout: 120_000 });
    attempt.status = "applied";
    attempt.detail = `Applied "${action.name}" for ${detail}.`;
  } catch (err) {
    attempt.status = "escalated";
    attempt.detail = `Repair "${action.name}" failed: ${err instanceof Error ? err.message : String(err)} (on-call).`;
  }
  await appendLog(attempt);
  return attempt;
}

export async function repairLog(limit = 50): Promise<RepairAttempt[]> {
  return (await readLog()).slice(-limit);
}
