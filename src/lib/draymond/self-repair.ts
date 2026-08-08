/**
 * Self-repair — detect failure signals and attempt automated recovery.
 *
 * Uses Draymond's monitors + the QA tool as failure signals, then applies a
 * known repair action (restart a service, re-run a job, clear a cache). Every
 * attempt is logged and fed to self-learning. Deterministic: only safe, known
 * repairs run automatically; unknown failures escalate to on-call.
 *
 * Failure-loop guard: the same signal is never blindly re-repaired. After N
 * applied repairs inside the cooldown window, further attempts escalate and
 * cool down so the loop is reported instead of hammered.
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

export interface RepairLoopReport {
  signal: string;
  attempts: number;
  window: { from: string; to: string };
  lastDetail: string;
  action: "escalated";
}

/** Known safe repairs keyed by failure signal (service + check). */
const STATIC_REPAIR_MAP: Record<string, RepairAction> = {
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

/**
 * Extend the repair map with operator-learned repairs from
 * `DRAYMOND_REPAIR_MAP` (JSON: { signal: { name, service, command[], safe } }).
 * This is the "lessons can register repairs" escape hatch: a repair proven by
 * experience can be registered without a code change.
 */
export function loadRepairMap(): Record<string, RepairAction> {
  const raw = process.env.DRAYMOND_REPAIR_MAP;
  if (!raw) return { ...STATIC_REPAIR_MAP };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const merged = { ...STATIC_REPAIR_MAP };
    for (const [signal, value] of Object.entries(parsed)) {
      const v = value as { name?: unknown; service?: unknown; command?: unknown; safe?: unknown };
      if (
        typeof v === "object" && v !== null &&
        typeof v.name === "string" &&
        Array.isArray(v.command) &&
        v.command.every((c) => typeof c === "string")
      ) {
        merged[signal] = {
          name: v.name,
          service: typeof v.service === "string" ? v.service : "draymond",
          command: v.command as string[],
          safe: v.safe === true,
        };
      }
    }
    return merged;
  } catch {
    return { ...STATIC_REPAIR_MAP };
  }
}

// ── Failure-loop guard thresholds (env-overridable) ──────────────────────────
const cooldownMs = () => Number(process.env.DRAYMOND_REPAIR_COOLDOWN_MS ?? 30 * 60 * 1000);
const maxInCooldown = () => Number(process.env.DRAYMOND_REPAIR_MAX_IN_COOLDOWN ?? 3);
const loopWindowMs = () => Number(process.env.DRAYMOND_REPAIR_LOOP_WINDOW_MS ?? 7 * 24 * 60 * 60 * 1000);
const loopThreshold = () => Number(process.env.DRAYMOND_REPAIR_LOOP_THRESHOLD ?? 3);

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

/** Applied repairs for a signal within the last `sinceMs` milliseconds. */
export async function appliedRepairs(signal: string, sinceMs: number): Promise<RepairAttempt[]> {
  const log = await readLog();
  const since = Date.now() - sinceMs;
  return log.filter((a) => a.signal === signal && a.status === "applied" && new Date(a.detectedAt).getTime() >= since);
}

/**
 * Detect repair loops: the same signal auto-repaired repeatedly within the
 * loop window. A loop means the blind repair is NOT working — escalate.
 */
export async function detectRepairLoops(limit = 20): Promise<RepairLoopReport[]> {
  const log = await readLog();
  const since = Date.now() - loopWindowMs();
  const bySignal = new Map<string, RepairAttempt[]>();
  for (const a of log) {
    if (a.status !== "applied") continue;
    const t = new Date(a.detectedAt).getTime();
    if (Number.isNaN(t) || t < since) continue;
    const arr = bySignal.get(a.signal) ?? [];
    arr.push(a);
    bySignal.set(a.signal, arr);
  }
  const reports: RepairLoopReport[] = [];
  for (const [signal, attempts] of bySignal) {
    if (attempts.length < loopThreshold()) continue;
    reports.push({
      signal,
      attempts: attempts.length,
      window: { from: attempts[0].detectedAt, to: attempts[attempts.length - 1].detectedAt },
      lastDetail: attempts[attempts.length - 1].detail,
      action: "escalated",
    });
  }
  return reports.slice(-limit);
}

/** Run a repair action. Only `safe` actions are executed; loops are escalated. */
export async function attemptRepair(signal: string, detail: string): Promise<RepairAttempt> {
  const map = loadRepairMap();
  const action = map[signal];
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

  // Failure-loop guard: don't blindly re-apply the same repair on a loop.
  const recent = await appliedRepairs(signal, cooldownMs());
  if (recent.length >= maxInCooldown()) {
    attempt.status = "escalated";
    attempt.detail = `Repair loop detected for "${signal}" — ${recent.length} auto-repairs within the cooldown window. Cooling down; on-call. ${detail}`;
    await appendLog(attempt);
    await recordRepairOutcome(attempt);
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
  await recordRepairOutcome(attempt);
  return attempt;
}

/** Feed every repair attempt into self-learning so lessons carry evidence. */
async function recordRepairOutcome(attempt: RepairAttempt): Promise<void> {
  try {
    const { recordOutcome } = await import("./self-learning");
    await recordOutcome({
      agentId: `repair:${attempt.signal}`,
      kind: "repair",
      summary: `repair ${attempt.action.name} (${attempt.signal})`,
      success: attempt.status === "applied",
      detail: attempt.detail,
    });
  } catch {
    /* learning store best-effort */
  }
}

export async function repairLog(limit = 50): Promise<RepairAttempt[]> {
  return (await readLog()).slice(-limit);
}
