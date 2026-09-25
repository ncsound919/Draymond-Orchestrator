import { writeBrainFile } from './journal';
/**
 * Repair Team — when a job fails, Draymond deploys coding/skill agents to fix it.
 *
 * Flow: detect failed jobs → classify the failure → assemble a repair crew
 * (coding agents for config/code, skill agents for skill issues) → apply a
 * known deterministic repair (config patches) or hand off to a coding agent →
 * supervised by Big Homie → outcome recorded to self-learning so lessons drive
 * future repairs. Every real outcome is ALSO reported to the operator + the
 * repair/coding team via a deterministic (templated, LLM-free) report.
 *
 * Fixing, not reporting: this module ACTUALLY dispatches repairs:
 *   - service_down  → attempts to START the real service (service-manager).
 *   - code_error    → dispatches the coding crew (opencode) to generate a patch
 *                     IMMEDIATELY on the first failure (bounded by a per-job
 *                     cooldown so tokens aren't burned on identical repeats).
 *   - missing_env   → escalates with a concrete provisioning instruction.
 *
 * Determinism for token savings: reports and info-passing between the repair
 * team, the coding crew, and the operator are rendered from fixed templates —
 * no LLM in the reporting path.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { localFailureTriage, repairLocalEnabled } from "./local-repair";
import { dispatchProjectRepair } from "./repair-crew";
import { codingStackSummary, resolveCodingTools } from "./coding-stack";
import { pipelineSummary } from "./fleet-pipelines";
import { TOOL_PORTS } from "./ports";
import { executeChainWithBrainFallback, TokenErrorType } from "./chain-execution-fallback";
import type { DraymondChain } from "./types";

// -- Dev-Brain repair triage (deterministic, advisory — never blocks dispatch) --

/** Order a batch of hiccups via Dev-Brain's risk_containment weighting. Exported for brain-decision + API. */
export async function devBrainTriageForRepair(
  hiccups: Array<{ id: string; title: string; description: string }>,
): Promise<string[] | null> {
  if (hiccups.length < 2) return null;
  try {
    const { devBrainRepairTriage } = await import('./dev-brain');
    const matrix = await devBrainRepairTriage({
      problem: 'Repair triage: order failing jobs and down monitors by blast radius, reversibility, and time-to-restore. Cheapest safe win first; irreversible / customer-facing last without human gate.',
      candidates: hiccups.map(h => ({ id: h.id, title: h.title, description: h.description, tags: ['repair', 'triage'] })),
      strategy: 'risk_containment',
    });
    if (!matrix) return null;
    return [...matrix.options].sort((a, b) => b.weightPercentage - a.weightPercentage).map(o => o.id);
  } catch {
    return null;
  }
}

/** Get Dev-Brain's triage matrix for a set of signals (for API responses / logging). Never throws. */
export async function devBrainRepairMatrix(
  hiccups: Array<{ id: string; title: string; description: string }>,
): Promise<import('./dev-brain').DevBrainMatrix | null> {
  if (hiccups.length === 0) return null;
  try {
    const { devBrainRepairTriage } = await import('./dev-brain');
    return await devBrainRepairTriage({
      problem: 'Repair triage: order failing jobs and down monitors by blast radius, reversibility, and time-to-restore.',
      candidates: hiccups.map(h => ({ id: h.id, title: h.title, description: h.description, tags: ['repair', 'triage'] })),
      strategy: 'risk_containment',
    });
  } catch { return null; }
}

export type FailureKind = 'chain_config' | 'notification_config' | 'missing_env' | 'service_down' | 'code_error' | 'benchmark_weak' | 'unknown';

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
  /** Lessons distilled from prior outcomes of this job (learning → repair feedback). */
  lessonHints?: string[];
  /** When a real agent/process was dispatched, what happened. */
  dispatch?: { kind: string; result: string; duration_ms?: number; engine?: string };
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

/** Ordered coding leads the master stack can put in front of a repair. */
export function codingLeadCandidates(): string[] {
  const ordered = resolveCodingTools("codegen");
  return ordered.length > 0 ? ordered : ["uplift-agent"];
}

export interface CrewOptions {
  /** A caller-preferred lead. Honoured only when it is a real coding candidate,
   *  so an unknown/mismatched lane (e.g. a service name from another vocabulary)
   *  is ignored rather than silently installing a bogus lead. */
  preferredLead?: string;
  /** Deterministic round-robin across the coding candidates. Off unless the
   *  operator enables it (DRAYMOND_REPAIR_EXPLORE=1): exploration changes which
   *  engine leads live repairs, so it is never on by default. */
  explore?: boolean;
  /** lead -> attempt count for this failure kind, from the repair log. Drives
   *  the round-robin: the least-attempted candidate leads next, so the
   *  experiment stays balanced and reproducible from the log alone. */
  attempts?: Record<string, number>;
}

/** The candidate with the fewest recorded attempts (ties → candidate order).
 *  Deterministic given the log, so a run is reproducible. */
export function leastAttempted(candidates: string[], attempts: Record<string, number> = {}): string {
  let best = candidates[0];
  let bestCount = attempts[best] ?? 0;
  for (const c of candidates) {
    const n = attempts[c] ?? 0;
    if (n < bestCount) { best = c; bestCount = n; }
  }
  return best;
}

/** Per-lead attempt counts for one failure kind, from a repair log. Pure. */
export function leadAttemptsFromLog(log: Array<{ failureKind?: string; crew?: { lead?: string } }>, kind: FailureKind): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of log) {
    if (r?.failureKind !== kind) continue;
    const lead = r?.crew?.lead;
    if (typeof lead !== "string" || !lead) continue;
    out[lead] = (out[lead] ?? 0) + 1;
  }
  return out;
}

export interface LeadStats {
  /** lead -> attempts for this kind. */
  attempts: Record<string, number>;
  /** lead -> repairs that ended `fixed` for this kind. */
  fixes: Record<string, number>;
}

/** Per-lead attempts AND fixes for one kind. Pure; `handed-off` counts as an
 *  attempt but never a fix (its result is unknown, so it cannot be credited). */
export function leadStatsFromLog(
  log: Array<{ failureKind?: string; crew?: { lead?: string }; action?: string }>,
  kind: FailureKind,
): LeadStats {
  const attempts: Record<string, number> = {};
  const fixes: Record<string, number> = {};
  for (const r of log) {
    if (r?.failureKind !== kind) continue;
    const lead = r?.crew?.lead;
    if (typeof lead !== "string" || !lead) continue;
    attempts[lead] = (attempts[lead] ?? 0) + 1;
    if (r?.action === "fixed") fixes[lead] = (fixes[lead] ?? 0) + 1;
  }
  return { attempts, fixes };
}

/** Fix rate for a lead, 0 when it has no attempts. */
function fixRate(stats: LeadStats, lead: string): number {
  const a = stats.attempts[lead] ?? 0;
  return a > 0 ? (stats.fixes[lead] ?? 0) / a : 0;
}

/**
 * The challenger lead that measurably beats the stack primary for this kind, or
 * undefined. Undefined means "keep the current behaviour" — either nothing is
 * measured yet, the primary is already best, or no challenger strictly wins. This
 * is the exploit half; the round-robin in `assembleCrew` is the explore half.
 */
export function bestLeadFromStats(
  stats: LeadStats,
  candidates: string[],
  minMatches = Number(process.env.DRAYMOND_REPAIR_LEAD_MIN_MATCHES) || 3,
): string | undefined {
  const primary = candidates[0];
  const measured = candidates.filter((l) => (stats.attempts[l] ?? 0) >= minMatches);
  if (measured.length === 0) return undefined;
  let best = measured[0];
  for (const l of measured) {
    if (fixRate(stats, l) > fixRate(stats, best)) best = l;
  }
  if (best === primary) return undefined;
  if (fixRate(stats, best) <= fixRate(stats, primary)) return undefined;
  return best;
}

/** Assemble the repair crew from the master coding stack. */
export function assembleCrew(kind: FailureKind, opts: CrewOptions = {}): RepairCrew {
  switch (kind) {
    case "chain_config":
    case "notification_config":
    case "code_error":
    case "benchmark_weak": {
      // Definitive coding stack: codegen (Uplift Agent primary) + review
      // (RepoRank) + IDE daemon (Mutly), supervised by Big Homie.
      const codegen = resolveCodingTools("codegen");
      const review = resolveCodingTools("review");
      const ide = resolveCodingTools("ide");
      const candidates = codingLeadCandidates();
      // Default (no options) is byte-identical to the historical behaviour:
      // candidates[0] === codegen[0] === the layer primary.
      const preferred = opts.preferredLead && candidates.includes(opts.preferredLead) ? opts.preferredLead : null;
      const lead = preferred ?? (opts.explore ? leastAttempted(candidates, opts.attempts) : candidates[0]);
      const members = [
        ...codegen.filter((t) => t !== lead),
        ...ide,
        review[0],
        "big-homie",
      ].filter((m) => m !== lead);
      const why = preferred
        ? `caller-preferred lead (${preferred})`
        : opts.explore
          ? `exploration round-robin (least-attempted lead)`
          : `stack primary`;
      return {
        lead,
        members,
        reason: `master coding stack (${codingStackSummary()}) | folded pipelines (${pipelineSummary()}) — coding agents apply the patch, Big Homie supervises | lead: ${why}`,
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

/** Read the repair log for per-lead attempts + fixes. Best-effort ({} on miss). */
export async function readLeadStats(kind: FailureKind): Promise<LeadStats> {
  try {
    const raw = await fs.readFile(REPAIR_LOG, "utf-8");
    const log = JSON.parse(raw) as Array<{ failureKind?: string; crew?: { lead?: string }; action?: string }>;
    return Array.isArray(log) ? leadStatsFromLog(log, kind) : { attempts: {}, fixes: {} };
  } catch {
    return { attempts: {}, fixes: {} };
  }
}

/**
 * Map a failed job to the service(s) it depends on. Uses the job name and the
 * error text against the service catalog so service_down repairs know WHAT to
 * start instead of guessing.
 */
export function serviceForFailure(jobName: string, error: string): string[] {
  const e = `${jobName} ${error}`.toLowerCase();
  const matches: string[] = [];
  const catalog: Array<{ slug: string; keywords: string[] }> = [
    { slug: "bookbridge", keywords: ["book", "library", "scan"] },
    { slug: "deterministic-brain", keywords: ["brain", "kaggle", "deterministic"] },
    { slug: "hemp-os", keywords: ["hemp-os", "hemp os", "hemp_os"] },
    { slug: "hempforge", keywords: ["hempforge", "hemp forge", "hempforge"] },
    { slug: "uplift", keywords: ["uplift-agent", "uplift agent"] },
    { slug: "sports-steve", keywords: ["sports-steve", "sports steve"] },
    { slug: "mutly", keywords: ["mutly"] },
    { slug: "opencode", keywords: ["opencode"] },
  ];
  for (const c of catalog) {
    if (c.keywords.some((k) => e.includes(k))) matches.push(c.slug);
  }
  // Port-based: match "localhost:<port>" / ":<port>" in the error.
  const portRe = /localhost:(\d+)|127\.0\.0\.1:(\d+)/g;
  let m: RegExpExecArray | null;
  const ports: number[] = [];
  while ((m = portRe.exec(e)) !== null) {
    ports.push(Number(m[1] ?? m[2]));
  }
  if (ports.length > 0) {
    for (const p of ports) {
      const tool = TOOL_PORTS.find((t) => t.port === p);
      if (tool && !matches.includes(tool.slug)) matches.push(tool.slug);
    }
  }
  return matches;
}

export interface RepairRepairOptions {
  /** Per-engine codegen timeout (ms) for this dispatch. */
  dispatchTimeoutMs?: number;
  /** Override the immediate-dispatch mode for this call. */
  immediate?: boolean;
  /** Caller-preferred coding lead (e.g. Axiom's outcome-ranked lane). Honoured
   *  only when it is a real coding candidate; otherwise ignored. */
  preferredLead?: string;
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
  /** Distilled lessons for this job — the repair crew consults them. */
  lessonHints: string[] = [],
  options: RepairRepairOptions = {},
): Promise<RepairReport> {
  const deterministicKind = classifyFailure(error);
  let kind = deterministicKind;
  // Local-first triage refinement: only override the fuzzy buckets (unknown /
  // code_error) and only on a confident local verdict. The deterministic
  // classifier stays the baseline; disabled/offline => no change.
  if (repairLocalEnabled() && (deterministicKind === "unknown" || deterministicKind === "code_error")) {
    try {
      const triage = await localFailureTriage({ jobName: job.name, jobType: job.job_type, error, deterministicKind });
      if (triage.source === "local-model" && triage.confidence >= 0.7 && triage.kind !== deterministicKind) {
        kind = triage.kind;
      }
    } catch {
      /* keep deterministic */
    }
  }
  // Lead selection. Exploration is opt-in (DRAYMOND_REPAIR_EXPLORE=1): it
  // changes which engine leads live repairs, so the default stays the
  // deterministic stack primary. When enabled: exploit a challenger that
  // measurably beats the primary, else round-robin to the least-attempted
  // candidate so contrasts keep being generated. A caller-supplied
  // `preferredLead` always wins.
  const explore = process.env.DRAYMOND_REPAIR_EXPLORE === "1";
  let learnedLead: string | undefined;
  let attempts: Record<string, number> | undefined;
  if (explore) {
    const stats = await readLeadStats(kind);
    attempts = stats.attempts;
    learnedLead = bestLeadFromStats(stats, codingLeadCandidates());
  }
  const crew = assembleCrew(kind, {
    ...(options.preferredLead ?? learnedLead ? { preferredLead: options.preferredLead ?? learnedLead } : {}),
    explore,
    attempts,
  });
  const base = { jobId: job.id, jobName: job.name, failureKind: kind, error, crew, repairedAt: new Date().toISOString(), lessonHints };

  if (job.job_type === 'chain' || typeof job.job_config?.chain_slug === 'string' || typeof job.job_config?.trigger_type === 'string') {
    const chainResult = await executeChainWithBrainFallback({
      chain: {
        id: job.id,
        name: job.name,
        slug: job.name,
        trigger_type: typeof job.job_config.trigger_type === 'string' ? job.job_config.trigger_type : 'manual',
        trigger_config: {},
        input_data: (job.job_config as Record<string, unknown>) ?? {},
        output_data: {},
        context: {},
        description: null,
        version: '1.0.0',
        is_template: false,
        template_id: null,
        created_by: null,
        agent_id: null,
        status: 'failed',
        started_at: null,
        completed_at: null,
        total_steps: 0,
        completed_steps: 0,
        failed_steps: 0,
        total_duration_ms: null,
        error_message: error,
        retry_count: 0,
        max_retries: 0,
        session_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as DraymondChain,
      error: new Error(error),
      inputData: job.job_config as Record<string, unknown>,
    });

    if (chainResult.fallback_used) {
      // Credential-class failures are NEVER "fixed" by a deterministic-brain
      // stopgap: the brain can produce output, but the expired/invalid token
      // that caused the failure is still broken and will fail the next run.
      // Recording 'fixed' here masked dead credentials indefinitely (the
      // Aug-2026 research-brief-delivery 401 loop). The brain result is
      // recorded as an ESCALATION with an explicit credential-repair ask.
      const credentialClass =
        chainResult.errorType === TokenErrorType.EXPIRED_TOKEN ||
        chainResult.errorType === TokenErrorType.INVALID_CREDENTIALS;
      const detail = credentialClass
        ? `brain stopgap produced output for ${job.name}, but root cause is UNREPAIRED (${chainResult.errorType}) — credential rotation required for this chain's entity`
        : chainResult.success
          ? `deterministic brain completed failed chain ${job.name} after service outage`
          : `deterministic brain attempted fallback for ${job.name}: ${chainResult.error ?? 'unknown failure'}`;

      const action = credentialClass ? 'escalated' : chainResult.success ? 'fixed' : 'escalated';

      await recordRepair({
        ...base,
        action,
        detail,
        dispatch: { kind: 'deterministic-brain', result: chainResult.success ? 'completed' : 'failed' },
      });

      return {
        ...base,
        action,
        detail,
        dispatch: { kind: 'deterministic-brain', result: chainResult.success ? 'completed' : 'failed' },
      };
    }
  }

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
    // Manual-cluster mode (DRAYMOND_AUTO_START_SERVICES=0): never auto-start —
    // report the down service for the operator to load deliberately.
    if (process.env.DRAYMOND_AUTO_START_SERVICES === '0') {
      const detail = `service_down but auto-start disabled (manual cluster mode) — operator loads ${serviceForFailure(job.name, error).join(', ') || job.name} per task`;
      await recordRepair({ ...base, action: "escalated", detail });
      return { ...base, action: "escalated", detail, dispatch: { kind: "service_start", result: "disabled" } };
    }
    // ACTUALLY try to start the service the job depends on.
    const targets = serviceForFailure(job.name, error);
    if (targets.length === 0) {
      await recordRepair({ ...base, action: "escalated", detail: `service_down but no service mapped for "${job.name}" — escalate` });
      return { ...base, action: "escalated", detail: `service_down but no service mapped for "${job.name}" — escalate` };
    }
    try {
      const { startDownServices } = await import("./service-manager");
      const started = await startDownServices(targets);
      const up = started.filter((s) => s.up);
      const down = started.filter((s) => !s.up);
      if (up.length > 0) {
        const detail = `started ${up.map((s) => s.slug).join(", ")} (${up.map((s) => s.detail).join("; ")})` +
          (down.length ? `; still down: ${down.map((s) => `${s.slug} (${s.detail})`).join("; ")}` : "");
        const action: RepairReport["action"] = down.length === 0 ? "fixed" : "handed-off";
        await recordRepair({ ...base, action, detail, dispatch: { kind: "service_start", result: detail } });
        return { ...base, action, detail, dispatch: { kind: "service_start", result: detail } };
      }
      const detail = `failed to start ${targets.join(", ")}: ${started.map((s) => `${s.slug} (${s.detail})`).join("; ")}`;
      await recordRepair({ ...base, action: "escalated", detail, dispatch: { kind: "service_start", result: detail } });
      return { ...base, action: "escalated", detail, dispatch: { kind: "service_start", result: detail } };
    } catch (err) {
      const detail = `service start threw: ${err instanceof Error ? err.message : String(err)}`;
      await recordRepair({ ...base, action: "escalated", detail });
      return { ...base, action: "escalated", detail };
    }
  }

  // code_error / unknown → dispatch the coding crew to GENERATE a fix. With
  // immediate mode (default) the FIRST failure dispatches so fixes start now;
  // the per-job cooldown stops repeated identical failures from re-dispatching
  // and burning tokens. Legacy mode (DRAYMOND_REPAIR_IMMEDIATE=0) keeps the
  // old evidence-gated behaviour (dispatches only after repeated failures).
  if (kind === "code_error" || kind === "unknown") {
    const immediate = options.immediate ?? process.env.DRAYMOND_REPAIR_IMMEDIATE !== "0";
    const hasEvidence = lessonHints.length > 0 || /repeated/i.test(error);
    try {
      const { isOnCooldown } = await import("./workflow-budget");
      const cooldownKey = `repair:${job.id}`;
      const onCooldown = isOnCooldown(cooldownKey, "codegen", Number(process.env.DRAYMOND_REPAIR_DISPATCH_COOLDOWN_MS) || 30 * 60 * 1000);
      if (onCooldown) {
        const detail = `coding repair dispatched recently (cooldown) — ${crew.lead} on the next window`;
        const action: RepairReport["action"] = "handed-off";
        await recordRepair({ ...base, action, detail, dispatch: { kind: "deferred", result: detail } });
        return { ...base, action, detail, dispatch: { kind: "deferred", result: detail } };
      }
      if (!immediate && !hasEvidence) {
        const detail = `no repeated-failure evidence yet — ${crew.lead} will repair after 2+ failures (token-saving)`;
        const action: RepairReport["action"] = "handed-off";
        await recordRepair({ ...base, action, detail, dispatch: { kind: "deferred", result: detail } });
        return { ...base, action, detail, dispatch: { kind: "deferred", result: detail } };
      }
      // Real repair first: when the job maps to a workspace, hand Axiom a
      // project loop (file edits + typecheck + repo tests + Recourse verify +
      // rollback). Axiom owns PASS/FAIL and writes the outcome back.
      const project = await dispatchProjectRepair({ job, error, lessons: lessonHints });
      if (project) {
        const report: RepairReport = { ...base, action: project.action, detail: project.detail, dispatch: project.dispatch };
        await recordRepair(report);
        return report;
      }
      const { dispatchCodingRepair } = await import("./coding-repair");
      const outcome = await dispatchCodingRepair(job, error, lessonHints, crew, { timeoutMs: options.dispatchTimeoutMs });
      await recordRepair({ ...base, action: outcome.action, detail: outcome.detail, dispatch: outcome.dispatch });
      return { ...base, action: outcome.action, detail: outcome.detail, dispatch: outcome.dispatch };
    } catch (err) {
      const detail = `coding repair dispatch failed: ${err instanceof Error ? err.message : String(err)}`;
      await recordRepair({ ...base, action: "handed-off", detail });
      return { ...base, action: "handed-off", detail };
    }
  }

  await recordRepair({ ...base, action: "handed-off", detail: `handed to ${crew.lead} + ${crew.members.join(", ")} for code/skill repair` });
  return { ...base, action: "handed-off", detail: `handed to ${crew.lead} + ${crew.members.join(", ")}` };
}

// ============================================================================
// BENCHMARK WEAKNESS REPAIR — auto-fix components flagged by Benchmark Olympics
// ============================================================================

export interface BenchmarkWeakEntity {
  component_slug: string;
  component_name: string;
  weakness_score: number;
  reasons: string[];
  proposed_action?: string;
  repo_url?: string | null;
}

/**
 * Dispatch the repair team on a weak benchmark component (Benchmark Olympics
 * discovery loop → /api/ops/repair-benchmark). Two auto-fix channels:
 *
 *   1. Failover config fix — reuses the upgrade-queue failover matrix
 *      (reconfigureEntity, gated by DRAYMOND_FAILOVER_MATRIX) to apply safe,
 *      reversible invocation changes (retries/timeout) on the component.
 *   2. Coding crew — opencode (primary) → uplift-agent (fallback) → a
 *      deterministic terminal plan, so a code/config fix is PROPOSED and
 *      captured for the crew lead even when no engine is reachable.
 *
 * Guardrails: only score >= 50 is dispatched; a per-component cooldown stops
 * repeated loops from hammering the same slug; the whole path records to the
 * repair-team log + self-learning and reports deterministically.
 *
 * Kill switch: DRAYMOND_REPAIR_BENCHMARK_ENABLED=0 makes this proposal-only
 * (records a handed-off report without dispatching engines).
 */
export async function repairWeakEntity(
  entity: BenchmarkWeakEntity,
  options: RepairRepairOptions = {},
): Promise<RepairReport> {
  const score = Math.round(entity.weakness_score ?? 0);
  const reasons = Array.isArray(entity.reasons) ? entity.reasons : [];
  const proposedAction = entity.proposed_action || 'Reconfigure invocation (model, endpoint, retries) and run a repair pass.';
  const crew = assembleCrew('benchmark_weak');
  const base = {
    jobId: `benchmark:${entity.component_slug}`,
    jobName: entity.component_name || entity.component_slug,
    failureKind: 'benchmark_weak' as FailureKind,
    error: reasons.join('; ').slice(0, 800) || `benchmark weakness score ${score}`,
    crew,
    repairedAt: new Date().toISOString(),
    lessonHints: [],
  };

  // Monitor band — below the remediation band, nothing to auto-fix.
  if (score < 50) {
    const report: RepairReport = {
      ...base,
      action: 'handed-off',
      detail: `weakness ${score} below the remediation band (>=50) — monitor only. ${proposedAction}`,
    };
    await recordRepair(report);
    return report;
  }

  // Per-component cooldown so a repeated discovery loop can't hammer the same slug.
  try {
    const { isOnCooldown } = await import('./workflow-budget');
    const onCooldown = isOnCooldown(`repair-benchmark:${entity.component_slug}`, 'codegen', Number(process.env.DRAYMOND_REPAIR_DISPATCH_COOLDOWN_MS) || 30 * 60 * 1000);
    if (onCooldown) {
      const report: RepairReport = {
        ...base,
        action: 'handed-off',
        detail: `benchmark repair for ${entity.component_slug} dispatched recently (cooldown) — next window`,
        dispatch: { kind: 'deferred', result: 'cooldown' },
      };
      await recordRepair(report);
      return report;
    }
  } catch { /* best-effort */ }

  const autoFixEnabled = process.env.DRAYMOND_REPAIR_BENCHMARK_ENABLED !== '0';

  if (!autoFixEnabled) {
    const report: RepairReport = {
      ...base,
      action: 'handed-off',
      detail: `benchmark weakness ${score} for ${entity.component_slug} — ${proposedAction}. ` +
        `Auto-fix disabled (DRAYMOND_REPAIR_BENCHMARK_ENABLED=0); handed to ${crew.lead} for review.`,
    };
    await recordRepair(report);
    return report;
  }

  // 1. Failover config fix (deterministic, gated by DRAYMOND_FAILOVER_MATRIX).
  let configDetail: string | null = null;
  try {
    const { reconfigureEntity } = await import('./upgrade-queue');
    const applied = await reconfigureEntity(entity.component_slug, score, reasons);
    if (applied && applied.type !== 'monitor') {
      configDetail = `failover config applied: ${applied.action}`;
    }
  } catch { /* best-effort — coding crew still runs */ }

  // 2. Coding crew generates a fix for the weak component.
  const jobLike = {
    id: `benchmark:${entity.component_slug}`,
    name: base.jobName,
    job_type: 'benchmark',
    job_config: {
      component_slug: entity.component_slug,
      weakness_score: score,
      reasons,
      proposed_action: proposedAction,
      repo_url: entity.repo_url ?? null,
    },
  };
  let outcome;
  try {
    const { dispatchCodingRepair } = await import("./coding-repair");
    outcome = await dispatchCodingRepair(jobLike, base.error, [], crew, { timeoutMs: options.dispatchTimeoutMs });
  } catch (err) {
    outcome = {
      action: 'handed-off' as const,
      detail: `coding repair dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
      dispatch: { kind: 'codegen' as const, engine: 'dispatch', result: 'threw' },
    };
  }

  const detail = [configDetail, outcome.detail].filter(Boolean).join(' | ');
  const report: RepairReport = {
    ...base,
    action: configDetail ? 'fixed' : outcome.action,
    detail,
    dispatch: outcome.dispatch,
  };
  await recordRepair(report);
  return report;
}

async function recordRepair(report: RepairReport): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  let log: RepairReport[] = [];
  try {
    const raw = await fs.readFile(REPAIR_LOG, "utf-8");
    log = JSON.parse(raw) as RepairReport[];
  } catch { /* fresh log */ }
  log.push(report);
  await writeBrainFile(REPAIR_LOG, JSON.stringify(log.slice(-200), null, 2), "append", "repair-team");

  // S9 verification gate: a "fixed" verdict only OPENS a verification window.
  // The repair counts as closed once the affected service pings healthy
  // N consecutive times (POST /api/ping/:slug); sweepStaleVerifications()
  // escalates windows that never fill. Disable with DRAYMOND_REPAIR_GATE=0.
  if (report.action === 'fixed' && process.env.DRAYMOND_REPAIR_GATE !== '0') {
    try {
      const { registerRepairVerification } = await import('./repair-gate');
      const entry = registerRepairVerification(`repair:${report.jobId}`, report.jobName);
      console.log(`[repair-gate] verification opened for ${entry.slug} (${entry.requiredPings} healthy pings required)`);
    } catch { /* best-effort */ }
  }

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

  // Recourse memory write-back (through Axiom's guarded bridge) so future
  // repairs can recall what was tried. Bounded to real outcomes, best-effort.
  if (report.action === 'fixed' || report.action === 'escalated') {
    try {
      const { writeRepairOutcome } = await import('./repair-crew');
      await writeRepairOutcome({
        goal: `${report.jobName}: ${report.failureKind}`,
        status: report.action,
        findings: [report.detail.slice(0, 300)],
      });
    } catch { /* best-effort */ }
  }

  // OpenHub ecosystem-aware repair intake: mirror the repair to OpenHub so it
  // audits the tool's PRELOADED local folder and dispatches the fix to Axiom
  // with the same targetDir (no full-codebase rescan by Axiom/opencode).
  // Best-effort — OpenHub being down never blocks the local repair path.
  // Only report code/skill repairs with a real outcome, not silent deferrals.
  const openHubReportable =
    (report.action === 'fixed' || report.action === 'escalated' || report.action === 'handed-off') &&
    report.failureKind !== 'unknown';
  if (openHubReportable) {
    try {
      const { reportToOpenHubBestEffort } = await import('./openhub-report');
      await reportToOpenHubBestEffort({
        toolId: report.jobName.toLowerCase().replace(/[^a-z0-9-_]/g, '-') || 'draymond',
        source: 'draymond',
        severity: report.action === 'escalated' ? 'high' : report.action === 'fixed' ? 'medium' : 'medium',
        kind: `repair:${report.failureKind}`,
        detail: `${report.jobName} (${report.action}): ${report.detail.slice(0, 2000)}`,
        preset: 'quick',
      });
    } catch { /* best-effort */ }
  }

  // Deterministic report to the operator + the repair/coding team. Silent
  // deferrals (cooldown / waiting for evidence) don't email; real outcomes do.
  const shouldReport =
    report.action === 'fixed' ||
    report.action === 'escalated' ||
    (report.action === 'handed-off' && report.dispatch?.kind !== 'deferred');
  if (shouldReport) {
    try {
      await sendRepairReport(report);
    } catch { /* best-effort */ }
  }
}

// ============================================================================
// DETERMINISTIC REPAIR REPORT — templated, no LLM (token-saving by design)
// ============================================================================

const FAILURE_LABEL: Record<FailureKind, string> = {
  chain_config: 'Chain config',
  notification_config: 'Notification config',
  missing_env: 'Missing env',
  service_down: 'Service down',
  code_error: 'Code error',
  benchmark_weak: 'Benchmark weakness',
  unknown: 'Unknown',
};

const ACTION_LABEL: Record<RepairReport['action'], string> = {
  fixed: 'FIXED',
  'handed-off': 'HANDED OFF',
  escalated: 'ESCALATED',
};

/** Render a repair report as a fixed, deterministic text block (no LLM). */
export function renderRepairReport(report: RepairReport): string {
  const lines = [
    `Draymond Repair Report`,
    ``,
    `Job: ${report.jobName} (${report.jobId})`,
    `Failure: ${FAILURE_LABEL[report.failureKind] ?? report.failureKind}`,
    `Outcome: ${ACTION_LABEL[report.action] ?? report.action}`,
    `Crew: ${report.crew.lead}${report.crew.members.length ? ` + ${report.crew.members.join(', ')}` : ''}`,
    ``,
    `Detail: ${report.detail}`,
    report.dispatch ? `Dispatch: [${report.dispatch.kind}] ${report.dispatch.result}` : '',
    report.lessonHints?.length ? `Lessons: ${report.lessonHints.join(' | ')}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

const reportCooldownMs = () => Number(process.env.DRAYMOND_REPAIR_REPORT_COOLDOWN_MS) || 30 * 60 * 1000;

/**
 * Push a deterministic repair report to the operator (email) AND the
 * repair/coding team (ntfy repair topic). Best-effort, never throws, and
 * deduped per job+outcome so a burst of failures cannot flood the inbox.
 */
export async function sendRepairReport(report: RepairReport): Promise<boolean> {
  const text = renderRepairReport(report);
  let sent = false;

  // ntfy → the repair/coding team + the phone (Open-Chat auto-speaks).
  try {
    const base = process.env.NTFY_URL;
    const topic = process.env.NTFY_TOPIC_REPAIR ?? process.env.NTFY_TOPIC_RESULTS;
    if (base && topic) {
      const res = await fetch(base.replace(/\/+$/, ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic,
          title: `Draymond repair — ${report.jobName} (${report.action})`,
          message: text.slice(0, 1500),
          tags: report.action === 'fixed' ? ['white_check_mark'] : ['wrench'],
          priority: report.action === 'escalated' ? 5 : 3,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      sent = sent || res.ok;
    }
  } catch { /* best-effort */ }

  // Email → the operator. Deduped so identical job outcomes don't spam.
  try {
    const recipient = process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER;
    if (recipient) {
      const { isOnCooldown } = await import('./workflow-budget');
      if (!isOnCooldown(`report:${report.jobId}`, report.action, reportCooldownMs())) {
        const { sendMemo } = await import('./notifications');
        await sendMemo(`Draymond repair — ${report.jobName} (${report.action})`, text, recipient);
        sent = true;
      }
    }
  } catch { /* best-effort */ }

  return sent;
}

export async function repairLog(limit = 50): Promise<RepairReport[]> {
  try {
    const raw = await fs.readFile(REPAIR_LOG, "utf-8");
    return (JSON.parse(raw) as RepairReport[]).slice(-limit);
  } catch {
    return [];
  }
}
