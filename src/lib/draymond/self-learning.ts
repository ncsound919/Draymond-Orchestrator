/**
 * Self-learning — capture outcomes, distill lessons, feed improvements back.
 *
 * Every completed job/QA run/incident can be logged as an outcome; the learning
 * loop clusters them into lessons ("what worked / what broke") that the fleet
 * references on future runs. Deterministic + evidence-based.
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface LearningOutcome {
  id: string;
  agentId: string;
  kind: "job" | "qa" | "incident" | "repair" | "benchmark" | "manual";
  summary: string;
  success: boolean;
  /** Optional context: what was tried / what happened. */
  detail: string;
  createdAt: string;
}

export interface Lesson {
  id: string;
  agentId: string;
  pattern: string;
  lesson: string;
  evidenceCount: number;
  lastSeen: string;
}

const DIR = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
const OUTCOMES_FILE = path.join(DIR, "learning-outcomes.json");
const LESSONS_FILE = path.join(DIR, "learning-lessons.json");

async function readOutcomes(): Promise<LearningOutcome[]> {
  try {
    const raw = await fs.readFile(OUTCOMES_FILE, "utf-8");
    return JSON.parse(raw) as LearningOutcome[];
  } catch {
    return [];
  }
}

async function readLessons(): Promise<Lesson[]> {
  try {
    const raw = await fs.readFile(LESSONS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { lessons?: Lesson[] };
    return Array.isArray(parsed.lessons) ? parsed.lessons : [];
  } catch {
    return [];
  }
}

async function writeLessons(lessons: Lesson[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(LESSONS_FILE, JSON.stringify({ lessons, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
}

function patternOf(summary: string): string {
  // Normalize to a coarse pattern: first 4 significant words.
  return summary.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3).slice(0, 4).join(" ");
}

export async function recordOutcome(input: Omit<LearningOutcome, "id" | "createdAt">): Promise<LearningOutcome> {
  const outcome: LearningOutcome = { ...input, id: `lo_${Date.now()}`, createdAt: new Date().toISOString() };
  const outcomes = await readOutcomes();
  outcomes.push(outcome);
  await fs.writeFile(OUTCOMES_FILE, JSON.stringify(outcomes.slice(-500), null, 2), "utf-8");
  return outcome;
}

/**
 * Record a benchmark gain as a self-learning outcome. A positive gain is a
 * success (the component improved); a negative gain or a regression is logged
 * so `distillLessons` can cluster repeated regressions into a lesson.
 */
export async function recordBenchmarkGain(input: {
  agentId: string;
  component: string;
  scorer: string;
  baseline: number | null;
  current: number | null;
  gainPct: number | null;
}): Promise<LearningOutcome> {
  const { agentId, component, scorer, baseline, current, gainPct } = input;
  const gain =
    gainPct != null
      ? `${gainPct > 0 ? "+" : ""}${gainPct}%`
      : "n/a";
  const detail = `benchmark ${component} ${scorer}: baseline=${baseline ?? "n/a"} current=${current ?? "n/a"} gain=${gain}`;
  return recordOutcome({
    agentId,
    kind: "benchmark",
    summary: `${component} ${scorer} benchmark`,
    success: gainPct != null && gainPct >= 0,
    detail,
  });
}

/** Record a full set of benchmark gains (one outcome per component+scorer). */
export async function recordBenchmarkGains(
  gains: Array<{
    agentId: string;
    component: string;
    scorer: string;
    baseline: number | null;
    current: number | null;
    gainPct: number | null;
  }>
): Promise<LearningOutcome[]> {
  const recorded: LearningOutcome[] = [];
  for (const g of gains) {
    recorded.push(await recordBenchmarkGain(g));
  }
  return recorded;
}

/** Cluster recent outcomes into lessons. Call nightly. */
export async function distillLessons(limit = 200): Promise<Lesson[]> {
  const outcomes = (await readOutcomes()).slice(-limit);
  const byPattern = new Map<string, LearningOutcome[]>();
  for (const o of outcomes) {
    const key = `${o.agentId}:${patternOf(o.summary)}`;
    const arr = byPattern.get(key) ?? [];
    arr.push(o);
    byPattern.set(key, arr);
  }

  const lessons: Lesson[] = [];
  for (const [key, group] of byPattern.entries()) {
    if (group.length < 2) continue; // need repetition to call it a lesson
    const [agentId] = key.split(":");
    const failCount = group.filter((g) => !g.success).length;
    const last = group[group.length - 1]!;
    lessons.push({
      id: `ls_${key.replace(/[^a-z0-9]/g, "").slice(0, 24)}`,
      agentId,
      pattern: group[0]!.summary,
      lesson:
        failCount >= group.length / 2
          ? `Repeated failure: "${group[0]!.summary}" (${failCount}/${group.length}). ${group[0]!.detail}`
          : `Repeated pattern: "${group[0]!.summary}" (${group.length}x).`,
      evidenceCount: group.length,
      lastSeen: last.createdAt,
    });
  }

  await writeLessons(lessons);
  return lessons;
}

export async function getLessons(agentId?: string): Promise<Lesson[]> {
  const lessons = await readLessons();
  return agentId ? lessons.filter((l) => l.agentId === agentId) : lessons;
}
