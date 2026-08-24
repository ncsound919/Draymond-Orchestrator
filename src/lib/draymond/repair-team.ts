import { writeBrainFile } from './journal';
/**
 * Repair Team â€” when a job fails, Draymond deploys coding/skill agents to fix it.
 *
 * Flow: detect failed jobs â†’ classify the failure â†’ assemble a repair crew
 * (coding agents for config/code, skill agents for skill issues) â†’ apply a
 * known deterministic repair (config patches) or hand off to a coding agent â†’
 * supervised by Big Homie â†’ outcome recorded to self-learning so lessons drive
 * future repairs. Every real outcome is ALSO reported to the operator + the
 * repair/coding team via a deterministic (templated, LLM-free) report.
 *
 * Fixing, not reporting: this module ACTUALLY dispatches repairs:
 *   - service_down  â†’ attempts to START the real service (service-manager).
 *   - code_error    â†’ dispatches the coding crew (opencode) to generate a patch
 *                     IMMEDIATELY on the first failure (bounded by a per-job
 *                     cooldown so tokens aren't burned on identical repeats).
 *   - missing_env   â†’ escalates with a concrete provisioning instruction.
 *
 * Determinism for token savings: reports and info-passing between the repair
 * team, the coding crew, and the operator are rendered from fixed templates â€”
 * no LLM in the reporting path.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { codingStackSummary, resolveCodingTools } from "./coding-stack";
import { pipelineSummary } from "./fleet-pipelines";
import { TOOL_PORTS } from "./ports";
import { executeChainWithBrainFallback } from "./chain-execution-fallback";

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
  /** Lessons distilled from prior outcomes of this job (learning â†’ repair feedback). */
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

/** Assemble the repair crew from the master coding stack. */
export function assembleCrew(kind: FailureKind): RepairCrew {
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
        reason: `master coding stack (${codingStackSummary()}) | folded pipelines (${pipelineSummary()}) â€” coding agents apply the patch, Big Homie supervises`,
      };
    }
    case "missing_env":
      return {
        lead: "uplift-agent",
        members: ["skill-vetter", "big-homie"],
        reason: "env/config gap â€” verify + document the required key",
      };
    case "service_down":
      return {
        lead: "overlay-auditor",
        members: ["agent-browser", "big-homie"],
        reason: "service reachability â€” audit + restart",
      };
    default:
      return { lead: "omniresearch-pro", members: ["megacode", "big-homie"], reason: "investigate unknown failure" };
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
  /** Distilled lessons for this job â€” the repair crew consults them. */
  lessonHints: string[] = [],
  options: RepairRepairOptions = {},
): Promise<RepairReport> {
  const kind = classifyFailure(error);
  const crew = assembleCrew(kind);
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
      } as any,
      error: new Error(error),
      inputData: job.job_config as Record<string, unknown>,
    });

    if (chainResult.fallback_used) {
      const detail = chainResult.success
        ? `deterministic brain completed failed chain ${job.name} after token/service outage`
        : `deterministic brain attempted fallback for ${job.name}: ${chainResult.error ?? 'unknown failure'}`;

      await recordRepair({
        ...base,
        action: chainResult.success ? 'fixed' : 'escalated',
        detail,
        dispatch: { kind: 'deterministic-brain', result: chainResult.success ? 'completed' : 'failed' },
      });

      return {
        ...base,
        action: chainResult.success ? 'fixed' : 'escalated',
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
    await recordRepair({ ...base, action: "escalated", detail: `env gap â€” assign ${crew.lead} to provision the missing key` });
    return { ...base, action: "escalated", detail: `env gap â€” assign ${crew.lead} to provision the missing key` };
  }

  if (kind === "service_down") {
    // ACTUALLY try to start the service the job depends on.
    const targets = serviceForFailure(job.name, error);
    if (targets.length === 0) {
      await recordRepair({ ...base, action: "escalated", detail: `service_down but no service mapped for "${job.name}" â€” escalate` });
      return { ...base, action: "escalated", detail: `service_down but no service mapped for "${job.name}" â€” escalate` };
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

  // code_error / unknown â†’ dispatch the coding crew to GENERATE a fix. With
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
        const detail = `coding repair dispatched recently (cooldown) â€” ${crew.lead} on the next window`;
        const action: RepairReport["action"] = "handed-off";
        await recordRepair({ ...base, action, detail, dispatch: { kind: "deferred", result: detail } });
        return { ...base, action, detail, dispatch: { kind: "deferred", result: detail } };
      }
      if (!immediate && !hasEvidence) {
        const detail = `no repeated-failure evidence yet â€” ${crew.lead} will repair after 2+ failures (token-saving)`;
        const action: RepairReport["action"] = "handed-off";
        await recordRepair({ ...base, action, detail, dispatch: { kind: "deferred", result: detail } });
        return { ...base, action, detail, dispatch: { kind: "deferred", result: detail } };
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
// BENCHMARK WEAKNESS REPAIR â€” auto-fix components flagged by Benchmark Olympics
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
 * discovery loop â†’ /api/ops/repair-benchmark). Two auto-fix channels:
 *
 *   1. Failover config fix â€” reuses the upgrade-queue failover matrix
 *      (reconfigureEntity, gated by DRAYMOND_FAILOVER_MATRIX) to apply safe,
 *      reversible invocation changes (retries/timeout) on the component.
 *   2. Coding crew â€” opencode (primary) â†’ uplift-agent (fallback) â†’ a
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

  // Monitor band â€” below the remediation band, nothing to auto-fix.
  if (score < 50) {
    const report: RepairReport = {
      ...base,
      action: 'handed-off',
      detail: `weakness ${score} below the remediation band (>=50) â€” monitor only. ${proposedAction}`,
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
        detail: `benchmark repair for ${entity.component_slug} dispatched recently (cooldown) â€” next window`,
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
      detail: `benchmark weakness ${score} for ${entity.component_slug} â€” ${proposedAction}. ` +
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
  } catch { /* best-effort â€” coding crew still runs */ }

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
// DETERMINISTIC REPAIR REPORT â€” templated, no LLM (token-saving by design)
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

  // ntfy â†’ the repair/coding team + the phone (Open-Chat auto-speaks).
  try {
    const base = process.env.NTFY_URL;
    const topic = process.env.NTFY_TOPIC_REPAIR ?? process.env.NTFY_TOPIC_RESULTS;
    if (base && topic) {
      const res = await fetch(base.replace(/\/+$/, ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic,
          title: `Draymond repair â€” ${report.jobName} (${report.action})`,
          message: text.slice(0, 1500),
          tags: report.action === 'fixed' ? ['white_check_mark'] : ['wrench'],
          priority: report.action === 'escalated' ? 5 : 3,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      sent = sent || res.ok;
    }
  } catch { /* best-effort */ }

  // Email â†’ the operator. Deduped so identical job outcomes don't spam.
  try {
    const recipient = process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER;
    if (recipient) {
      const { isOnCooldown } = await import('./workflow-budget');
      if (!isOnCooldown(`report:${report.jobId}`, report.action, reportCooldownMs())) {
        const { sendMemo } = await import('./notifications');
        await sendMemo(`Draymond repair â€” ${report.jobName} (${report.action})`, text, recipient);
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
