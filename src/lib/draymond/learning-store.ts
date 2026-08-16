/**
 * Unified shared learning store — the "one brain" every self-learning loop
 * reads and writes: fleet repair outcomes/lessons, research-grade weights +
 * discoveries, Benchmark Olympics facet weights/drift, and publication events.
 *
 * JSON-state registry pattern (see cognition.ts readJsonState/writeJsonState),
 * with a serialized write chain so concurrent writers never corrupt the file
 * (the same fix self-learning.ts applied to its outcome file).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonState, writeJsonState, nowIso } from './cognition';

export interface LearningOutcome {
  id: string;
  agentId: string;
  kind: 'job' | 'qa' | 'incident' | 'repair' | 'benchmark' | 'manual';
  summary: string;
  success: boolean;
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

export interface GradeWeights {
  novelty: number;
  testability: number;
  evidence: number;
  impact: number;
  maturity: number;
  crossDomain: number;
}

export interface SelfTunedFacetWeights {
  speedAndLatency: number;
  securityAndDefense: number;
  reliabilityAndSla: number;
  costAndEfficiency: number;
  lastRecalibratedAt: string;
  recalibrationReason: string;
}

export interface DriftDetectionMetrics {
  conceptDriftDetected: boolean;
  covariateShiftDetected: boolean;
  driftMagnitude: number;
  klDivergenceBits?: number;
  lastEvaluatedAt: string;
  shiftedFeatures: string[];
  recommendedAction: string;
}

export interface ResearchGrade {
  goalId: string;
  domain: string;
  area: string;
  title: string;
  score: number;
  evidenceTier: string;
  breakthroughClass: 'frontier' | 'promising' | 'exploratory' | 'low';
  trend: string;
  gradedAt: string;
}

export interface PublicationEvent {
  id: string;
  goalId: string;
  discoveryId: string;
  source: string;
  publishedAt: string;
  gradeScore: number;
  outcome: 'success' | 'low_grade_published';
}

export interface LearningStore {
  outcomes: LearningOutcome[];
  lessons: Lesson[];
  gradeWeights: GradeWeights | null;
  benchmarkWeights: SelfTunedFacetWeights | null;
  driftMetrics: DriftDetectionMetrics | null;
  discoveries: ResearchGrade[];
  publicationEvents: PublicationEvent[];
  updatedAt: string;
}

const STORE_NAME = 'learning-store';

export function emptyStore(): LearningStore {
  return {
    outcomes: [], lessons: [], gradeWeights: null, benchmarkWeights: null,
    driftMetrics: null, discoveries: [], publicationEvents: [],
    updatedAt: nowIso(),
  };
}

// ── Serialized write chain (one read-modify-write at a time) ────────────────
let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task);
  writeChain = next;
  return next as Promise<T>;
}

export async function readLearningStore(): Promise<LearningStore> {
  try {
    const s = await readJsonState<LearningStore>(STORE_NAME, emptyStore());
    const merged = { ...emptyStore(), ...s };

    // Legacy migration: self-learning.ts used separate files.
    const legacyOutcomes = await readLegacyJson<LearningOutcome[]>('learning-outcomes.json', []);
    const legacyLessons = await readLegacyJson<{ lessons?: Lesson[] }>('learning-lessons.json', { lessons: [] });
    if (legacyOutcomes.length > 0) {
      for (const o of legacyOutcomes) {
        if (!merged.outcomes.some((m) => m.id === o.id)) merged.outcomes.push(o);
      }
    }
    if (Array.isArray(legacyLessons.lessons)) {
      for (const l of legacyLessons.lessons) {
        if (!merged.lessons.some((m) => m.id === l.id)) merged.lessons.push(l);
      }
    }
    return merged;
  } catch {
    return emptyStore();
  }
}

async function readLegacyJson<T>(name: string, fallback: T): Promise<T> {
  const dir = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond');
  try {
    const raw = await fs.readFile(path.join(dir, name), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeLearningStore(store: LearningStore): Promise<void> {
  store.updatedAt = nowIso();
  await writeJsonState(STORE_NAME, store);
}

export function addOutcome(input: Omit<LearningOutcome, 'id' | 'createdAt'>): Promise<LearningOutcome> {
  return enqueueWrite(async () => {
    const store = await readLearningStore();
    const outcome: LearningOutcome = {
      ...input,
      id: `lo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: nowIso(),
    };
    store.outcomes.push(outcome);
    store.outcomes = store.outcomes.slice(-500);
    await writeLearningStore(store);
    return outcome;
  });
}

export function addOutcomesBatch(inputs: Array<Omit<LearningOutcome, 'id' | 'createdAt'>>): Promise<LearningOutcome[]> {
  return enqueueWrite(async () => {
    const store = await readLearningStore();
    const created = inputs.map((i) => ({
      ...i,
      id: `lo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: nowIso(),
    } as LearningOutcome));
    store.outcomes.push(...created);
    store.outcomes = store.outcomes.slice(-500);
    await writeLearningStore(store);
    return created;
  });
}

export function saveGradeWeights(weights: GradeWeights): Promise<void> {
  return enqueueWrite(async () => {
    const store = await readLearningStore();
    store.gradeWeights = weights;
    await writeLearningStore(store);
  });
}

export function saveBenchmarkWeights(weights: SelfTunedFacetWeights, drift: DriftDetectionMetrics | null): Promise<void> {
  return enqueueWrite(async () => {
    const store = await readLearningStore();
    store.benchmarkWeights = weights;
    store.driftMetrics = drift;
    await writeLearningStore(store);
  });
}

export function saveDiscoveries(discoveries: ResearchGrade[]): Promise<void> {
  return enqueueWrite(async () => {
    const store = await readLearningStore();
    store.discoveries = discoveries;
    await writeLearningStore(store);
  });
}

export function savePublicationEvent(event: PublicationEvent): Promise<void> {
  return enqueueWrite(async () => {
    const store = await readLearningStore();
    store.publicationEvents.push(event);
    store.publicationEvents = store.publicationEvents.slice(-200);
    await writeLearningStore(store);
  });
}

export function saveLessons(lessons: Lesson[]): Promise<void> {
  return enqueueWrite(async () => {
    const store = await readLearningStore();
    store.lessons = lessons;
    await writeLearningStore(store);
  });
}

/** Cluster recent outcomes into lessons (moved from self-learning.ts). */
export async function distillLessonsFromStore(limit = 200): Promise<Lesson[]> {
  const store = await readLearningStore();
  const outcomes = store.outcomes.slice(-limit);
  const byPattern = new Map<string, LearningOutcome[]>();
  for (const o of outcomes) {
    const pattern = patternOf(o.summary);
    const key = `${o.agentId}:${pattern}`;
    const arr = byPattern.get(key) ?? [];
    arr.push(o);
    byPattern.set(key, arr);
  }

  const lessons: Lesson[] = [];
  for (const [key, group] of byPattern.entries()) {
    if (group.length < 2) continue;
    const idx = key.lastIndexOf(':');
    const agentId = key.slice(0, idx);
    const failCount = group.filter((g) => !g.success).length;
    const last = group[group.length - 1]!;
    lessons.push({
      id: `ls_${key.replace(/[^a-z0-9]/g, '').slice(0, 24)}`,
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

  await saveLessons(lessons);
  return lessons;
}

function patternOf(summary: string): string {
  return summary.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 3).slice(0, 4).join(' ');
}

export async function lessonsFromStore(agentId?: string): Promise<Lesson[]> {
  const store = await readLearningStore();
  return agentId ? store.lessons.filter((l) => l.agentId === agentId) : store.lessons;
}
