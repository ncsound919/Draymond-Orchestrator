import { writeBrainFile } from './journal';
/**
 * Repair Shift â€” the daily fleet repair/upgrade shift.
 *
 * One coherent daily shift across the ecosystem, mirroring the user's operating
 * model: the CODE REVIEW team audits, then the REPAIR team fixes and upgrades
 * throughout the ecosystem, improvements are noted and benchmarked, and the
 * self-learning system drives consistent optimization.
 *
 * Shift phases (deterministic, bounded, best-effort per phase):
 *   1. AUDIT  â€” code-review team pass: run benchmark cycles across entity/site/
 *               cron/chain and deep-score (RepoRank/Grader/Vibe-Reality) the
 *               weakest components. This is the "code review team auditing".
 *   2. REPAIR â€” repair team pass: repair failed scheduler jobs and weak
 *               benchmark components (repairWeakEntity), and start down
 *               services. Fixed per-run bounds so tokens stay sane.
 *   3. BENCHMARK IMPROVEMENTS â€” for every component the shift acted on, compare
 *               its weakness trend before/after and record the gain (or
 *               regression) to self-learning (recordBenchmarkGain).
 *   4. SELF-LEARNING â€” distill the day's outcomes into lessons so the next
 *               shift starts smarter (the "consistent optimization" loop).
 *
 * Every phase is guarded (try/catch) so one offline engine can't sink the
 * whole shift; the shift log records what ran, what failed, and the net
 * improvement deltas. The full run returns a compact summary the scheduler can
 * surface in recaps + kairos.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { nowIso } from "./cognition";
import type { ComponentClass } from "./types";

export interface RepairShiftResult {
  shiftId: string;
  startedAt: string;
  audit: {
    measured: number;
    deepScored: number;
    weakest: Array<{ slug: string; score: number; componentClass: string }>;
  };
  repair: {
    jobsRepaired: number;
    componentsRepaired: number;
    servicesStarted: string[];
    failures: string[];
  };
  improvements: Array<{
    component: string;
    componentClass: string;
    baseline: number | null;
    current: number | null;
    gainPct: number | null;
  }>;
  lessons: number;
  durationMs: number;
}

const DIR = (): string => process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
const SHIFT_LOG = (): string => path.join(DIR(), "repair-shift-log.json");

export interface RepairShiftOptions {
  /** Max failed jobs to repair this shift. */
  maxJobs?: number;
  /** Max weak components (score >= 50) to repair this shift. */
  maxComponents?: number;
  /** Max components to deep-score in the audit phase. */
  deepScoreLimit?: number;
  /** Skip the audit deep-scoring pass (faster / offline). */
  skipDeepScore?: boolean;
}

function clampInt(v: number | undefined, fallback: number, lo: number, hi: number): number {
  const n = Number(v ?? fallback);
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? Math.round(n) : fallback));
}

/**
 * Run the daily repair shift. Every phase is best-effort and bounded; the
 * returned summary is always shaped, never throws.
 */
export async function runRepairShift(options: RepairShiftOptions = {}): Promise<RepairShiftResult> {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const maxJobs = clampInt(options.maxJobs, 10, 0, 20);
  const maxComponents = clampInt(options.maxComponents, 5, 0, 15);
  const deepScoreLimit = options.skipDeepScore ? 0 : clampInt(options.deepScoreLimit, 3, 0, 8);

  const shiftId = `shift_${startedAt.replace(/[:TZ]/g, "").slice(0, 14)}`;

  const result: RepairShiftResult = {
    shiftId,
    startedAt,
    audit: { measured: 0, deepScored: 0, weakest: [] },
    repair: { jobsRepaired: 0, componentsRepaired: 0, servicesStarted: [], failures: [] },
    improvements: [],
    lessons: 0,
    durationMs: 0,
  };

  // â”€â”€ Phase 1: AUDIT (code-review team) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const weakTargets: Array<{ slug: string; score: number; componentClass: string; reasons: string[] }> = [];
  try {
    const { runBenchmarkCycle } = await import("./run-benchmark");
    for (const cls of ["entity", "site", "cron", "chain"] as const) {
      try {
        const cycle = await runBenchmarkCycle(cls, {
          queueLimit: Math.max(maxComponents, deepScoreLimit + 1),
          deepScoreLimit: cls === "entity" ? deepScoreLimit : 0,
        });
        result.audit.measured += cycle.measured;
        result.audit.deepScored += cycle.deepScored;
        for (const w of cycle.weakest.slice(0, maxComponents)) {
          weakTargets.push({ ...w, componentClass: cls, reasons: [] });
        }
      } catch (err) {
        result.repair.failures.push(`audit:${cls}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.repair.failures.push(`audit: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Dedupe targets by slug+class, keep highest score, drop healthy.
  const seen = new Set<string>();
  for (const t of [...weakTargets]
    .sort((a, b) => b.score - a.score)
    .filter((t) => t.score >= 50)) {
    const key = `${t.componentClass}:${t.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.audit.weakest.push({ slug: t.slug, score: t.score, componentClass: t.componentClass });
  }
  result.audit.weakest = result.audit.weakest.slice(0, maxComponents);

  // â”€â”€ Phase 2: REPAIR (repair team) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // 2a. Failed scheduler jobs.
  try {
    const { listJobs, updateJob } = await import("./scheduler");
    const { repairFailedJob } = await import("./repair-team");
    const { repairHintsFor } = await import("./learning-repair");
    const failed = (await listJobs()).filter((j) => j.last_run_status === "failed").slice(0, maxJobs);
    for (const job of failed) {
      try {
        const hints = await repairHintsFor(`scheduler:${job.name}`);
        const report = await repairFailedJob(
          { id: job.id, name: job.name, job_type: job.job_type, job_config: job.job_config ?? {} },
          job.last_error ?? "unknown error",
          { updateJobConfig: (id, config) => updateJob(id, { job_config: config }) },
          hints.map((h) => h.lesson),
        );
        if (report.action === "fixed") result.repair.jobsRepaired++;
      } catch (err) {
        result.repair.failures.push(`repair:${job.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.repair.failures.push(`repair-jobs: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2b. Weak benchmark components (score >= 50).
  for (const target of result.audit.weakest.slice(0, maxComponents)) {
    try {
      const { repairWeakEntity } = await import("./repair-team");
      const report = await repairWeakEntity({
        component_slug: target.slug,
        component_name: target.slug,
        weakness_score: target.score,
        reasons: [],
      });
      if (report.action === "fixed") result.repair.componentsRepaired++;
    } catch (err) {
      result.repair.failures.push(`repair:${target.componentClass}:${target.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2c. Start down services.
  try {
    const { probeAllServices, startDownServices, startableDownServices } = await import("./service-manager");
    const all = await probeAllServices();
    const down = all.filter((s) => !s.up).map((s) => s.slug);
    const startable = startableDownServices(down).slice(0, 5);
    const started = await startDownServices(startable);
    result.repair.servicesStarted = started.filter((s) => s.up).map((s) => s.slug);
  } catch (err) {
    result.repair.failures.push(`services: ${err instanceof Error ? err.message : String(err)}`);
  }

  // â”€â”€ Phase 3: BENCHMARK IMPROVEMENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Compare each acted-on component's weakness score in THIS run vs its last
  // run. The audit phase already recorded this run's scores into the benchmark
  // history, so `getTrend`'s last value is the current score and the
  // second-to-last is the pre-shift baseline â€” a true shift-over-shift delta,
  // not a self-comparison.
  try {
    const { getTrend } = await import("./benchmarking");
    const { recordBenchmarkGain } = await import("./self-learning");
    for (const w of result.audit.weakest.slice(0, 20)) {
      const trend = await getTrend(w.componentClass as ComponentClass, w.slug, 10);
      const current = trend.length > 0 ? trend[trend.length - 1] : null;
      const baseline = trend.length >= 2 ? trend[trend.length - 2] : null;
      const gainPct =
        baseline != null && current != null && baseline > 0
          ? Math.round(((baseline - current) / baseline) * 100)
          : null;
      result.improvements.push({
        component: w.slug,
        componentClass: w.componentClass,
        baseline,
        current,
        gainPct,
      });
      await recordBenchmarkGain({
        agentId: `repair-shift:${w.componentClass}`,
        component: w.slug,
        scorer: "repair-shift",
        baseline,
        current,
        gainPct,
      });
    }
  } catch (err) {
    result.repair.failures.push(`improvements: ${err instanceof Error ? err.message : String(err)}`);
  }

  // â”€â”€ Phase 4: SELF-LEARNING (consistent optimization) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  try {
    const { distillLessons } = await import("./self-learning");
    const lessons = await distillLessons();
    result.lessons = lessons.length;
  } catch (err) {
    result.repair.failures.push(`learn: ${err instanceof Error ? err.message : String(err)}`);
  }

  result.durationMs = Date.now() - startedMs;
  await recordShift(result);
  return result;
}

async function recordShift(result: RepairShiftResult): Promise<void> {
  try {
    await fs.mkdir(DIR(), { recursive: true });
    let log: RepairShiftResult[] = [];
    try {
      const raw = await fs.readFile(SHIFT_LOG(), "utf-8");
      log = JSON.parse(raw) as RepairShiftResult[];
    } catch {
      /* fresh log */
    }
    log.push(result);
    await writeBrainFile(SHIFT_LOG(), JSON.stringify(log.slice(-100), null, 2), "append", "repair-shift");
  } catch {
    /* best-effort */
  }
}

/** Recent repair-shift history (newest first). */
export async function repairShiftLog(limit = 20): Promise<RepairShiftResult[]> {
  try {
    const raw = await fs.readFile(SHIFT_LOG(), "utf-8");
    return (JSON.parse(raw) as RepairShiftResult[]).slice(-limit).reverse();
  } catch {
    return [];
  }
}
