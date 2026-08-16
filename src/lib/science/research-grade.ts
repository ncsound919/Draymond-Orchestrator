/**
 * science/research-grade.ts — breakthrough-potential grading of research output.
 *
 * Grades every active science goal (CureMind/BB-Tech biotech + sports) on the
 * likelihood its output leads to a TRUE breakthrough. Each goal is scored across
 * six evidence-grounded dimensions and mapped to a 0–1000 breakthrough score
 * (mirroring the benchmark 0–1000 convention). Grading is deterministic and
 * reads only JSON-state (goals, hypotheses, papers) + self-learning lessons.
 *
 * Self-learning feedback loop (consistently getting smarter):
 *   - Every grading run records outcomes to self-learning (`research-grade:*`).
 *   - `adaptedWeights` reads distilled lessons and re-balances dimension
 *     weights toward the dimensions that kept showing up in lessons, so the
 *     grader's priors drift with evidence, never with vibes.
 *   - Grade history per goal produces a rising/stable/falling trend.
 *
 * Trends / insights / discoveries:
 *   - `gradeResearch()` writes `.draymond/research-grades.json` (registry
 *     JSON-state pattern) with the current grades + per-goal history.
 *   - `discoveries()` returns the frontier (breakthrough-class) candidates —
 *     the research most likely to lead to real breakthroughs — so the fleet
 *     can push them to Overlay Global Lens and the paper pipeline.
 */

import { readJsonState, writeJsonState, nowIso } from '@/lib/draymond/cognition';
import { listGoals, listHypotheses, type ScienceGoal, type Hypothesis } from './goals';
import { hypothesisMaturity } from './priority';
import { papersForGoal, type Paper } from './papers';
import { getLessons, recordOutcome, type Lesson } from '@/lib/draymond/self-learning';
import {
  readLearningStore,
  saveGradeWeights,
  saveDiscoveries,
  addOutcome,
  type LearningOutcome,
} from '@/lib/draymond/learning-store';

export type ResearchDomain = 'biotech' | 'sports';
export type BreakthroughClass = 'frontier' | 'promising' | 'exploratory' | 'low';
export type GradeTrend = 'rising' | 'stable' | 'falling';
export type EvidenceTier = 'E1' | 'E2' | 'E3' | 'E4';

export interface GradeWeights {
  novelty: number;
  testability: number;
  evidence: number;
  impact: number;
  maturity: number;
  crossDomain: number;
}

export const DEFAULT_GRADE_WEIGHTS: GradeWeights = {
  novelty: 0.25,
  testability: 0.1,
  evidence: 0.25,
  impact: 0.2,
  maturity: 0.1,
  crossDomain: 0.1,
};

export interface ResearchGradeDimensions {
  novelty: number;
  testability: number;
  evidence: number;
  impact: number;
  maturity: number;
  crossDomain: number;
}

export interface ResearchGrade {
  goalId: string;
  domain: ResearchDomain;
  area: string;
  title: string;
  dimensions: ResearchGradeDimensions;
  score: number; // 0–1000
  evidenceTier: EvidenceTier;
  breakthroughClass: BreakthroughClass;
  trend: GradeTrend;
  hypotheses: Array<{ id: string; claim: string; status: Hypothesis['status'] }>;
  gradedAt: string;
}

export interface ResearchGradesState {
  grades: ResearchGrade[];
  /** Per-goal historical scores (oldest → newest) for trend classification. */
  history: Record<string, number[]>;
  updatedAt?: string;
}

export interface GradeInsight {
  type: 'trend' | 'optimization' | 'discovery';
  goalId: string;
  impact: number; // 0–100
  detail: string;
}

const STATE_NAME = 'research-grades';

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// ============================================================================
// Evidence tier from hypothesis statuses
// ============================================================================

function evidenceTierFor(hypotheses: Hypothesis[]): EvidenceTier {
  const statuses = hypotheses.map((h) => h.status);
  if (statuses.some((s) => s === 'supported' || s === 'refuted')) return 'E1';
  if (statuses.some((s) => s === 'in_progress')) return 'E2';
  return 'E4';
}

/** 0–1 evidence strength from an evidence tier (E1 strongest). */
export function evidenceStrength(tier: EvidenceTier): number {
  switch (tier) {
    case 'E1':
      return 1.0;
    case 'E2':
      return 0.75;
    case 'E3':
      return 0.5;
    default:
      return 0.25;
  }
}

// ============================================================================
// Dimension scoring
// ============================================================================

export interface GradeGoalInput {
  goal: ScienceGoal;
  hypotheses: Hypothesis[];
  papers: Paper[];
}

export function gradeDimensions(input: GradeGoalInput): ResearchGradeDimensions {
  const { goal, hypotheses, papers } = input;
  const tested = hypotheses.filter((h) => h.status !== 'untested').length;
  const untestedFrac = hypotheses.length === 0 ? 1 : (hypotheses.length - tested) / hypotheses.length;
  const maturity = hypothesisMaturity(hypotheses);
  const tier = evidenceTierFor(hypotheses);

  return {
    // Novelty: cross-domain value + unexplored (untested) hypotheses.
    novelty: clamp01(0.5 * (goal.cross_domain_value ?? 0) + 0.5 * untestedFrac),
    // Testability: grounded claims (hypotheses + real paper grounding).
    testability: clamp01(0.8 + 0.2 * Math.min(1, papers.length / 3)),
    // Evidence: real statuses → tier; E4 only when nothing has been tested.
    evidence: evidenceStrength(tier),
    // Impact: mission weight + breakthrough-relevant area signal.
    impact: clamp01((goal.base_weight ?? 0.8) * (0.8 + 0.2 * (goal.cross_domain_value ?? 0.5))),
    maturity,
    crossDomain: clamp01(goal.cross_domain_value ?? 0.5),
  };
}

export function gradeScore(dimensions: ResearchGradeDimensions, weights: GradeWeights = DEFAULT_GRADE_WEIGHTS): number {
  const weighted =
    weights.novelty * dimensions.novelty +
    weights.testability * dimensions.testability +
    weights.evidence * dimensions.evidence +
    weights.impact * dimensions.impact +
    weights.maturity * dimensions.maturity +
    weights.crossDomain * dimensions.crossDomain;
  return Math.round(Math.max(0, Math.min(1, weighted)) * 1000);
}

export function breakthroughClassFor(score: number): BreakthroughClass {
  if (score >= 750) return 'frontier';
  if (score >= 500) return 'promising';
  if (score >= 300) return 'exploratory';
  return 'low';
}

export function classifyGradeTrend(history: number[]): GradeTrend {
  if (history.length < 2) return 'stable';
  const delta = history[history.length - 1] - history[0];
  if (delta > 40) return 'rising';
  if (delta < -40) return 'falling';
  return 'stable';
}

// ============================================================================
// Self-learning weight adaptation
// ============================================================================

const DIMENSION_KEYWORDS: Record<keyof GradeWeights, string[]> = {
  novelty: ['novel', 'frontier', 'untested', 'cross', 'new'],
  testability: ['testable', 'claim', 'falsifi', 'paper', 'ground'],
  evidence: ['evidence', 'supported', 'refuted', 'e1', 'experiment'],
  impact: ['impact', 'breakthrough', 'weight', 'mission', 'revenue'],
  maturity: ['mature', 'supported', 'refuted', 'repeated pattern'],
  crossDomain: ['cross-domain', 'cross domain', 'transfer', 'translation'],
};

/**
 * Re-balance grading weights from distilled lessons. Lessons that name a
 * dimension steal weight from the un-named dimensions and give it to the named
 * ones (the total stays exactly 1 — no blind renormalization that can shrink a
 * boosted dimension). The effect compounds across runs: the grader's priors
 * drift toward whatever dimensions the fleet's own lessons keep emphasizing,
 * which is the self-learning loop making the grader smarter.
 */
export function adaptedWeights(lessons: Lesson[], prior: GradeWeights | null = null): GradeWeights {
  const weights = prior ? { ...prior } : { ...DEFAULT_GRADE_WEIGHTS };
  const dims = Object.keys(DIMENSION_KEYWORDS) as Array<keyof GradeWeights>;
  const deltas: Record<keyof GradeWeights, number> = {
    novelty: 0, testability: 0, evidence: 0, impact: 0, maturity: 0, crossDomain: 0,
  };

  for (const lesson of lessons) {
    if (!lesson.agentId?.startsWith('research-grade:')) continue;
    const text = `${lesson.pattern} ${lesson.lesson}`.toLowerCase();
    const boost = Math.min(3, lesson.evidenceCount ?? 1) * 0.03;
    for (const dim of dims) {
      const hits = DIMENSION_KEYWORDS[dim].filter((k) => text.includes(k)).length;
      if (hits > 0) deltas[dim] += boost * Math.min(2, hits);
    }
  }

  const emphasized = dims.filter((d) => deltas[d] > 0);
  const totalAdd = emphasized.reduce((a, d) => a + deltas[d], 0);
  if (totalAdd <= 0) return weights;

  // Steal from un-named dimensions proportionally to their current weight,
  // but never below a floor so no dimension is fully dropped by a hot lesson.
  const MIN_WEIGHT = 0.05;
  const unEmphasized = dims.filter((d) => deltas[d] === 0);
  const totalUn = unEmphasized.reduce((a, d) => a + weights[d], 0);
  let stolen = 0;
  for (const d of unEmphasized) {
    const share = totalUn > 0 ? weights[d] / totalUn : 1 / Math.max(1, unEmphasized.length);
    const maxCut = Math.max(0, weights[d] - MIN_WEIGHT);
    const cut = Math.min(maxCut, totalAdd * share);
    weights[d] -= cut;
    stolen += cut;
  }
  // Give to the named dimensions proportional to their lesson signal.
  for (const d of emphasized) {
    weights[d] = Math.min(0.9, weights[d] + stolen * (deltas[d] / totalAdd));
  }

  // Float-safety renormalize (sum is already ~1).
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const d of dims) weights[d] = weights[d] / total;
  return weights;
}

// ============================================================================
// State persistence (JSON-state registry pattern)
// ============================================================================

async function readGrades(): Promise<ResearchGradesState> {
  return readJsonState<ResearchGradesState>(STATE_NAME, { grades: [], history: {} });
}

async function writeGrades(state: ResearchGradesState): Promise<void> {
  await writeJsonState(STATE_NAME, state);
}

// ============================================================================
// Grading run
// ============================================================================

/**
 * Grade every active goal. Returns the graded rows (frontier first) and
 * persists the run to `.draymond/research-grades.json`. Deterministic given the
 * same goals/hypotheses/papers + lessons — the only moving part is the
 * self-learning weight adaptation, which is exactly the point.
 */
export async function gradeResearch(): Promise<{ grades: ResearchGrade[]; insights: GradeInsight[]; discoveries: ResearchGrade[] }> {
  const [goals, allHypotheses, lessons, state, storePrior] = await Promise.all([
    listGoals(),
    listHypotheses(),
    getLessons(),
    readGrades(),
    readLearningStore().then((s) => s.gradeWeights),
  ]);
  const weights = adaptedWeights(lessons, storePrior);
  const graded: ResearchGrade[] = [];
  const history: Record<string, number[]> = { ...state.history };

  for (const goal of goals) {
    if (goal.status !== 'active') continue;
    const hypotheses = allHypotheses.filter((h) => h.goal_id === goal.id);
    const papers = await papersForGoal(goal.id);
    const dimensions = gradeDimensions({ goal, hypotheses, papers });
    const score = gradeScore(dimensions, weights);
    const tier = evidenceTierFor(hypotheses);
    const prior = history[goal.id] ?? [];
    const trend = classifyGradeTrend([...prior, score]);
    history[goal.id] = [...prior, score].slice(-30);

    graded.push({
      goalId: goal.id,
      domain: goal.domain,
      area: goal.area,
      title: goal.title,
      dimensions,
      score,
      evidenceTier: tier,
      breakthroughClass: breakthroughClassFor(score),
      trend,
      hypotheses: hypotheses.map((h) => ({ id: h.id, claim: h.claim, status: h.status })),
      gradedAt: nowIso(),
    });
  }

  graded.sort((a, b) => b.score - a.score);

  // Record grading outcomes to self-learning ONLY when a goal's breakthrough
  // class changed vs the previous run (or it's the first run). Recording every
  // goal every run would flood learning-outcomes with title-word noise and
  // drift the grader's weights off evidence; class transitions are the
  // informative events the loop should learn from.
  try {
    const prevByGoal = new Map((state.grades ?? []).map((g) => [g.goalId, g]));
    for (const g of graded.slice(0, 20)) {
      const prev = prevByGoal.get(g.goalId);
      if (prev && prev.breakthroughClass === g.breakthroughClass) continue;
      await recordOutcome({
        agentId: `research-grade:${g.domain}`,
        kind: 'benchmark',
        summary: `${g.title} ${prev ? `${prev.breakthroughClass} → ${g.breakthroughClass}` : `graded ${g.breakthroughClass}`}`,
        success: g.score >= 500,
        detail: `score=${g.score} class=${g.breakthroughClass} evidence=${g.evidenceTier} dimensions=${JSON.stringify(g.dimensions)}`,
      });
    }
  } catch {
    /* self-learning store best-effort */
  }

  const insights = buildInsights(graded, history);
  const discoveries = graded.filter((g) => g.breakthroughClass === 'frontier' || g.breakthroughClass === 'promising');
  await writeGrades({ grades: graded, history });
  try {
    // Push adapted weights + discoveries to the unified store so CureMind and
    // Benchmark Olympics read from the same brain.
    await persistGradeWeightsForLearning(weights);
    await mirrorDiscoveriesForLearning(graded);
  } catch {
    /* unified store best-effort */
  }
  return { grades: graded, insights, discoveries };
}

// ============================================================================
// Unified store integration (Gap C foundation)
// ============================================================================

/** Persist the adapted grading weights to the unified store. */
export async function persistGradeWeightsForLearning(weights: GradeWeights): Promise<void> {
  await saveGradeWeights(weights);
}

/**
 * Mirror frontier/promising discoveries into the shared store so CureMind and
 * Benchmark Olympics can consume them without re-reading grades.
 */
export async function mirrorDiscoveriesForLearning(grades: ResearchGrade[]): Promise<void> {
  const slim = grades
    .filter((g) => g.breakthroughClass === 'frontier' || g.breakthroughClass === 'promising')
    .map((g) => ({
      goalId: g.goalId, domain: g.domain, area: g.area, title: g.title,
      score: g.score, evidenceTier: g.evidenceTier,
      breakthroughClass: g.breakthroughClass, trend: g.trend, gradedAt: g.gradedAt,
    }));
  await saveDiscoveries(slim);
}

/**
 * Turn publication events into self-learning outcomes. success = high-grade
 * publication; a low-grade publication is recorded as a negative outcome so the
 * grader learns from over-promising.
 */
export async function recordPublicationOutcomes(limit = 100): Promise<LearningOutcome[]> {
  const store = await readLearningStore();
  const events = store.publicationEvents.slice(-limit);
  const outcomes: LearningOutcome[] = [];
  for (const e of events) {
    const isHigh = e.outcome === 'success';
    outcomes.push(await addOutcome({
      agentId: 'research-grade:published',
      kind: 'benchmark',
      summary: `${e.goalId} published (score ${e.gradeScore})`,
      success: isHigh,
      detail: `source=${e.source} outcome=${e.outcome} discovery=${e.discoveryId}`,
    }));
  }
  return outcomes;
}

// ============================================================================
// Insights + discoveries
// ============================================================================

export function buildInsights(grades: ResearchGrade[], history: Record<string, number[]>): GradeInsight[] {
  const insights: GradeInsight[] = [];
  for (const g of grades) {
    const hist = history[g.goalId] ?? [];
    if (hist.length >= 2 && hist[hist.length - 1] - hist[hist.length - 2] > 40) {
      insights.push({
        type: 'trend',
        goalId: g.goalId,
        impact: 60,
        detail: `Breakthrough grade rising for "${g.title}" (+${hist[hist.length - 1] - hist[hist.length - 2]} pts this run).`,
      });
    }
    if (g.breakthroughClass === 'frontier' || g.breakthroughClass === 'promising') {
      insights.push({
        type: 'discovery',
        goalId: g.goalId,
        impact: g.breakthroughClass === 'frontier' ? 90 : 60,
        detail: `${g.breakthroughClass === 'frontier' ? 'Frontier' : 'Promising'} candidate: "${g.title}" (${g.score}/1000) — high breakthrough potential in the portfolio.`,
      });
    }
    if (g.dimensions.evidence < 0.5 && g.dimensions.novelty > 0.7) {
      insights.push({
        type: 'optimization',
        goalId: g.goalId,
        impact: 45,
        detail: `High-novelty, low-evidence goal "${g.title}" — run experiments to lift the evidence dimension and validate the frontier.`,
      });
    }
  }
  return insights.slice(0, 12);
}

// ============================================================================
// Discovery surface for consumers (CureMind / BB-Tech / Global Lens)
// ============================================================================

/** Top breakthrough-potential research outputs (frontier first). */
export async function discoveries(): Promise<ResearchGrade[]> {
  const state = await readGrades();
  return state.grades
    .filter((g) => g.breakthroughClass === 'frontier' || g.breakthroughClass === 'promising')
    .sort((a, b) => b.score - a.score);
}

/** Latest full grade for a single goal, or null. */
export async function gradeForGoal(goalId: string): Promise<ResearchGrade | null> {
  const state = await readGrades();
  return state.grades.find((g) => g.goalId === goalId) ?? null;
}

// ---------------------------------------------------------------------------
// CLI entry: npx --yes tsx src/lib/science/research-grade.ts
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('research-grade.ts')) {
  gradeResearch()
    .then((r) => {
      console.log(`Graded ${r.grades.length} research goals.`);
      r.grades.forEach((g) =>
        console.log(`  ${g.score} ${g.breakthroughClass.padEnd(12)} ${g.evidenceTier} ${g.trend.padEnd(7)} ${g.domain.padEnd(8)} ${g.title.slice(0, 70)}`)
      );
      console.log(`Discoveries (frontier/promising): ${r.discoveries.length}`);
      r.insights.forEach((i) => console.log(`  [${i.type}] ${i.detail}`));
    })
    .catch((e) => {
      console.error('FATAL', e);
      process.exit(1);
    });
}
