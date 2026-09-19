import { writeBrainFile } from './journal';
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
import {
  syncRepairCooldownMs,
  syncRepairMaxInCooldown,
  syncRepairLoopWindowMs,
  syncRepairLoopThreshold,
} from "@/lib/command-center/controls";

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
 * Known-benign failure signals that are recorded but never auto-repaired or
 * escalated — the fleet analogue of the kernel linker's `-IGNORE:<warnings>`
 * whitelist. A signal on this list means the team has judged it expected noise
 * (e.g. a monitor for a service intentionally offline, a check already handled
 * upstream). Ignored signals are still appended to the repair log for the
 * audit trail, but they never run a command, never escalate to on-call, and
 * never pollute self-learning with false failures.
 *
 * Extend at runtime via `DRAYMOND_IGNORE_SIGNALS` (JSON array or comma list).
 * Empty by default: the fleet fails closed — only a signal an operator has
 * explicitly judged benign is ignored.
 */
const DEFAULT_IGNORE_SIGNALS: string[] = [];

/** Resolve the benign-signal set: static defaults + env override. */
export function loadIgnoreSignals(): Set<string> {
  const out = new Set<string>(DEFAULT_IGNORE_SIGNALS);
  const raw = process.env.DRAYMOND_IGNORE_SIGNALS;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const s of parsed) if (typeof s === 'string' && s.trim()) out.add(s.trim());
      }
    } catch {
      for (const s of raw.split(',')) {
        const t = s.trim();
        if (t) out.add(t);
      }
    }
  }
  return out;
}

/** True when a signal is on the benign whitelist and should be skipped. */
export function isIgnoredSignal(signal: string): boolean {
  return loadIgnoreSignals().has(signal);
}

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

// -- Failure-loop guard thresholds (controls > env > default) ----------------
// The operator's Command Center knobs (stored via controls.json) win over the
// env vars; falling back to env, then the built-in default. Never throws.
const cooldownMs = () => syncRepairCooldownMs(process.env.DRAYMOND_REPAIR_COOLDOWN_MS);
const maxInCooldown = () => syncRepairMaxInCooldown(process.env.DRAYMOND_REPAIR_MAX_IN_COOLDOWN);
const loopWindowMs = () => syncRepairLoopWindowMs(process.env.DRAYMOND_REPAIR_LOOP_WINDOW_MS);
const loopThreshold = () => syncRepairLoopThreshold(process.env.DRAYMOND_REPAIR_LOOP_THRESHOLD);

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
  await writeBrainFile(LOG_FILE, JSON.stringify(log.slice(-200), null, 2), "append", "self-repair");
}

/** Applied repairs for a signal within the last `sinceMs` milliseconds. */
export async function appliedRepairs(signal: string, sinceMs: number): Promise<RepairAttempt[]> {
  const log = await readLog();
  const since = Date.now() - sinceMs;
  return log.filter((a) => a.signal === signal && a.status === "applied" && new Date(a.detectedAt).getTime() >= since);
}

/**
 * Repair EXECUTIONS (applied or attempted-and-failed) for a signal within
 * `sinceMs`. The loop guard uses this: failed executions must count, or a
 * broken repair command re-runs forever.
 */
async function executedRepairs(signal: string, sinceMs: number): Promise<RepairAttempt[]> {
  const log = await readLog();
  const since = Date.now() - sinceMs;
  return log.filter(
    (a) =>
      a.signal === signal &&
      (a.status === "applied" || (a.status === "escalated" && a.action.safe && a.action.command.length > 0)) &&
      new Date(a.detectedAt).getTime() >= since,
  );
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

/**
 * Resolve an affected service slug from a failure-signal detail string.
 * Monitor/job details carry human names ("Uplift Agent down", "monitor
 * omniresearch-pro down") — match them against TOOL_PORTS names/slugs so
 * monitor:down repairs target a concrete service instead of escalating as
 * "service: unknown" forever.
 */
export async function resolveServiceFromDetail(detail: string): Promise<string | null> {
  try {
    const { TOOL_PORTS } = await import("./ports");
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const d = norm(detail);
    if (!d) return null;
    // Longest name first so "Hermes Proxy" wins over partial overlaps.
    const candidates = TOOL_PORTS.filter((t) => typeof t.port === "number").sort(
      (a, b) => b.name.length - a.name.length,
    );
    for (const t of candidates) {
      if (d.includes(norm(t.name)) || d.includes(norm(t.slug))) return t.slug;
    }
  } catch {
    /* ports table unavailable — fall through to escalation */
  }
  return null;
}

/** Run a repair action. Only `safe` actions are executed; loops are escalated. */
export async function attemptRepair(signal: string, detail: string): Promise<RepairAttempt> {
  // Benign whitelist: record the attempt as skipped, never dispatch, escalate,
  // or run a command. Mirrors the kernel linker's -IGNORE warning whitelist.
  if (isIgnoredSignal(signal)) {
    const attempt: RepairAttempt = {
      id: `rp_${Date.now()}`,
      detectedAt: new Date().toISOString(),
      signal,
      action: { name: 'ignored', service: 'unknown', command: [], safe: false },
      status: 'skipped',
      detail: `Signal "${signal}" is on the benign whitelist — ${detail} (recorded, no repair).`,
    };
    await appendLog(attempt);
    return attempt;
  }

  const map = loadRepairMap();
  const action = map[signal];

  // monitor:down — resolve the concrete service and attempt a real start.
  // Uses the service-manager's proven start recipes (same path the bootstrap
  // uses), never restartService (its win32 branch taskkills ALL node.exe,
  // which would kill draymond itself). Unresolvable/unstartable services
  // still escalate, but with a precise detail instead of "unknown".
  if (signal === "monitor:down" && (!action || !action.safe)) {
    // Manual-cluster mode (2026-09-08): when the operator disables autonomous
    // service auto-start (DRAYMOND_AUTO_START_SERVICES=0), services are loaded
    // in clusters per task and a stopped service is deliberate, not a failure
    // to self-heal. Default remains ENABLED (fail-closed to the old behavior).
    if (process.env.DRAYMOND_AUTO_START_SERVICES === '0') {
      const attempt: RepairAttempt = {
        id: `rp_${Date.now()}`,
        detectedAt: new Date().toISOString(),
        signal,
        action: { name: 'no-auto-start', service: 'unknown', command: [], safe: false },
        status: 'skipped',
        detail: `Auto-start disabled (manual cluster mode). ${detail}`,
      };
      await appendLog(attempt);
      return attempt;
    }
    const slug = await resolveServiceFromDetail(detail);
    if (slug) {
      const sm = await import("./service-manager");
      if (!sm.canStartService(slug)) {
        const attempt: RepairAttempt = {
          id: `rp_${Date.now()}`,
          detectedAt: new Date().toISOString(),
          signal,
          action: { name: `start:${slug}`, service: slug, command: [], safe: false },
          status: "escalated",
          detail: `Service "${slug}" resolved but has no local start recipe/deps — escalate. ${detail}`,
        };
        await appendLog(attempt);
        return attempt;
      }
      // Per-service loop guard (cooldown keyed on slug, not the generic signal).
      const log = await readLog();
      const since = Date.now() - cooldownMs();
      const recent = log.filter(
        (a) => a.signal === signal && a.status === "applied" && a.action.service === slug &&
          new Date(a.detectedAt).getTime() >= since,
      );
      if (recent.length >= maxInCooldown()) {
        const attempt: RepairAttempt = {
          id: `rp_${Date.now()}`,
          detectedAt: new Date().toISOString(),
          signal,
          action: { name: `start:${slug}`, service: slug, command: [], safe: false },
          status: "escalated",
          detail: `Repair loop for "${slug}" — ${recent.length} starts within cooldown. Cooling down; on-call. ${detail}`,
        };
        await appendLog(attempt);
        await recordRepairOutcome(attempt);
        return attempt;
      }
      const health = await sm.startService(slug);
      const attempt: RepairAttempt = {
        id: `rp_${Date.now()}`,
        detectedAt: new Date().toISOString(),
        signal,
        action: { name: `start:${slug}`, service: slug, command: ["internal:start-service", slug], safe: true },
        status: health.up ? "applied" : "escalated",
        detail: health.up
          ? `Started "${slug}" — healthy at ${health.url}. ${detail}`
          : `Start attempt for "${slug}" failed health check: ${health.detail}`,
      };
      await appendLog(attempt);
      await recordRepairOutcome(attempt);
      return attempt;
    }
    // No service resolved — fall through to static-map escalation below, but
    // do not re-attempt every cycle: the escalation itself is the record.
  }

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
  // Counts APPLIED and FAILED-EXECUTION attempts: a repair whose command fails
  // every time used to record only "escalated" (which the guard ignores), so
  // it re-executed unbounded on every detection cycle.
  const recent = await executedRepairs(signal, cooldownMs());
  if (recent.length >= maxInCooldown()) {
    attempt.status = "escalated";
    attempt.detail = `Repair loop detected for "${signal}" — ${recent.length} repair attempts within the cooldown window. Cooling down; on-call. ${detail}`;
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
