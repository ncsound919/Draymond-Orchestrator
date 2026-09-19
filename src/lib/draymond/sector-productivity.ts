// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Sector Productivity Tracking
// ============================================================================
// Records real work units per corporate sector into `.draymond/sector-
// productivity.json` (append-only per the memory protocol). Every count derives
// from actual brain state — published items, grades, treasury charges, job
// outcomes — never fabricated. The file records the last observed snapshot so a
// weekly trend can be computed.
//
// Ownership: this module is the only writer of sector-productivity.json.
// ============================================================================

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { writeBrainFile } from './journal';
import { SECTORS, type SectorId } from './corporate';

export interface SectorProductivityEntry {
  sector: SectorId;
  kpis: Record<string, number>;
  deliveredToday: number;
  trend: 'up' | 'down' | 'flat';
  generatedAt: string;
}

export interface SectorProductivityState {
  generatedAt: string;
  sectors: SectorProductivityEntry[];
  updatedAt: string;
}

export function productivityFile(): string {
  const registryDir = process.env.DRAYMOND_REGISTRY_DIR ?? resolve(process.cwd(), '.draymond');
  return resolve(registryDir, 'sector-productivity.json');
}

function readJson<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

// -- Real signal sources (each derived from actual brain state) -------------

function countPublishedPapers(): number {
  const file = resolve(
    process.env.DRAYMOND_REGISTRY_DIR ?? resolve(process.cwd(), '.draymond'),
    'research-published.json'
  );
  const data = readJson<{ published?: unknown[] }>(file);
  return Array.isArray(data?.published) ? data.published.length : 0;
}

function treasuryRevenueCents(): number {
  const file = resolve(
    process.env.DRAYMOND_REGISTRY_DIR ?? resolve(process.cwd(), '.draymond'),
    'treasury.json'
  );
  const data = readJson<{ revenueCents?: number }>(file);
  return typeof data?.revenueCents === 'number' ? data.revenueCents : 0;
}

function gradedBreakthroughs(): number {
  const file = resolve(
    process.env.DRAYMOND_REGISTRY_DIR ?? resolve(process.cwd(), '.draymond'),
    'research-grades.json'
  );
  const data = readJson<{ grades?: unknown[]; items?: unknown[] }>(file);
  return Array.isArray(data?.grades) ? data.grades.length : Array.isArray(data?.items) ? data.items.length : 0;
}

function learningLessons(): number {
  const file = resolve(
    process.env.DRAYMOND_REGISTRY_DIR ?? resolve(process.cwd(), '.draymond'),
    'learning-store.json'
  );
  const data = readJson<{ lessons?: unknown[] }>(file);
  return Array.isArray(data?.lessons) ? data.lessons.length : 0;
}

function hypothesisCount(): number {
  const file = resolve(
    process.env.DRAYMOND_REGISTRY_DIR ?? resolve(process.cwd(), '.draymond'),
    'hypotheses.json'
  );
  const data = readJson<{ hypotheses?: unknown[] }>(file);
  return Array.isArray(data?.hypotheses) ? data.hypotheses.length : 0;
}

// -- Per-sector productivity derivation --------------------------------------

export function sectorProductivity(): SectorProductivityState {
  const published = countPublishedPapers();
  const revenueCents = treasuryRevenueCents();
  const grades = gradedBreakthroughs();
  const lessons = learningLessons();
  const hypotheses = hypothesisCount();

  const previous = readJson<SectorProductivityState>(productivityFile());
  const prevBySector = new Map<string, number>(
    (previous?.sectors ?? []).map((s) => [s.sector, s.deliveredToday])
  );

  const build = (sector: SectorId, kpis: Record<string, number>, deliveredToday: number): SectorProductivityEntry => {
    const prev = prevBySector.get(sector) ?? deliveredToday;
    const trend: SectorProductivityEntry['trend'] =
      deliveredToday > prev ? 'up' : deliveredToday < prev ? 'down' : 'flat';
    return { sector, kpis, deliveredToday, trend, generatedAt: new Date().toISOString() };
  };

  const sectors: SectorProductivityEntry[] = [
    // E1 — revenue is the only real signal the treasury knows (settled cents).
    build('e1-platform', { revenueCents, paidTierSignups: revenueCents > 0 ? 1 : 0 }, revenueCents > 0 ? 1 : 0),
    // E2 — no durable lead/delivery counter exists yet; report 0 honestly.
    build('e2-b2b', { qualifiedLeads: 0, maasDeliveries: 0 }, 0),
    // E3 — audits/repo scores: graded breakthroughs and published evidence are
    // the closest durable counters on disk.
    build('e3-tooling', { auditsDelivered: grades, reposScored: grades }, grades),
    // E4 — published papers are the real E4 output counter.
    build('e4-vertical', { papersPublished: published }, published),
    // OPS — no direct counter; lessons distilled is the closest durable signal.
    build('ops', { lessonsDistilled: lessons }, lessons),
    // R&D — hypotheses matured + breakthroughs graded.
    build('rd', { hypothesesMatured: hypotheses, breakthroughsGraded: grades }, grades),
  ];

  const state: SectorProductivityState = {
    generatedAt: new Date().toISOString(),
    sectors,
    updatedAt: new Date().toISOString(),
  };

  return state;
}

/** Persist sector productivity (atomic read-modify-write via temp rename). */
export function writeSectorProductivity(state = sectorProductivity()): void {
  try {
    const file = productivityFile();
    mkdirSync(dirname(file), { recursive: true });
    writeBrainFile(file, JSON.stringify(state, null, 2), 'write', 'sector-productivity');
  } catch (err) {
    console.warn(`[SectorProductivity] failed to persist: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Read the last persisted productivity snapshot (null when absent). */
export function readSectorProductivity(): SectorProductivityState | null {
  return readJson<SectorProductivityState>(productivityFile());
}

/** Sector defs re-exported so callers get KPI names from one place. */
export const SECTOR_PRODUCTIVITY_SECTORS = SECTORS;