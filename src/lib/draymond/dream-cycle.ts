/**
 * AutoDream — gated 4-phase memory consolidation ("your AI organizes its notes
 * while you sleep").
 *
 * Gates run cheapest → most expensive: lock → time → sessions → idle. All
 * consolidation writes touch ONLY the memory store and dream-cycle.json;
 * everything else is read-only. Fail-soft is a test contract: runDreamCycle()
 * NEVER rejects — every path returns a DreamReport (gated or errored).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createDraymondAdminClient } from './client';
import { storeMemory, logEvent } from './index';
import { runDecaySweep } from './memory-intelligence';
import { getLessons } from './self-learning';
import { readJsonState, writeJsonState, nowIso } from './cognition';
import type { DraymondMemory } from './types';

export type DreamGate = 'lock' | 'time' | 'sessions' | 'idle' | 'error';

export interface DreamPhaseCounts {
  oriented: { total: number; byTier: Record<string, number>; stale: number; duplicates: number };
  gathered: { events: number; outcomes: number; duplicateKeys: number; contradictedKeys: number; staleKeys: number; lowValueKeys: number };
  consolidated: { mergedKeys: number; correctedKeys: number; promoted: number; lessonsStored: number };
  pruned: { decayed: number; expired: number; indexEntries: number };
}

export interface DreamReport {
  lastDreamAt: string;
  sessionsCounted: number;
  phases: DreamPhaseCounts;
  entries: string[];
  durationMs: number;
  gatedBy?: DreamGate;
  error?: string;
}

export interface DreamState {
  lastDreamAt: string | null;
  sessionsCounted: number;
  lock: { locked: boolean; lockedAt: string | null };
  reports: DreamReport[];
  updatedAt: string;
}

// ============================================================================
// STATE
// ============================================================================

function DEFAULT_STATE(): DreamState {
  return { lastDreamAt: null, sessionsCounted: 0, lock: { locked: false, lockedAt: null }, reports: [], updatedAt: nowIso() };
}

async function readState(): Promise<DreamState> {
  return readJsonState<DreamState>('dream-cycle', DEFAULT_STATE());
}

async function writeState(state: DreamState): Promise<void> {
  await writeJsonState('dream-cycle', state);
}

// ============================================================================
// CONFIG + CONSTANTS
// ============================================================================

const STALE_DAYS = (): number => Math.max(1, Number(process.env.DREAM_STALE_DAYS ?? 30));
const MIN_HOURS = (): number => Math.max(1, Number(process.env.DREAM_MIN_HOURS ?? 24));
const MIN_SESSIONS = (): number => Math.max(1, Number(process.env.DREAM_MIN_SESSIONS ?? 5));
const STALE_LOCK_MS = 60 * 60_000;
const LOW_VALUE_FLOOR = 0.2;
const PROMOTE_FLOOR = 0.75;
const INDEX_CAP = 100;

function emptyPhases(): DreamPhaseCounts {
  return {
    oriented: { total: 0, byTier: {}, stale: 0, duplicates: 0 },
    gathered: { events: 0, outcomes: 0, duplicateKeys: 0, contradictedKeys: 0, staleKeys: 0, lowValueKeys: 0 },
    consolidated: { mergedKeys: 0, correctedKeys: 0, promoted: 0, lessonsStored: 0 },
    pruned: { decayed: 0, expired: 0, indexEntries: 0 },
  };
}

function emptyReport(state: DreamState): DreamReport {
  return { lastDreamAt: state.lastDreamAt ?? nowIso(), sessionsCounted: 0, phases: emptyPhases(), entries: [], durationMs: 0 };
}

// ============================================================================
// SESSION COUNTING — recorded actions + completed jobs + completed chains
// ============================================================================

async function countSessionsSince(sinceIso: string | null): Promise<number> {
  const supabase = createDraymondAdminClient();
  const since = sinceIso ?? new Date(0).toISOString();
  const [actions, jobs, chains] = await Promise.all([
    supabase.from('draymond_actions').select('id', { count: 'exact', head: true }).gte('created_at', since),
    supabase.from('draymond_scheduled_jobs').select('id', { count: 'exact', head: true }).gte('updated_at', since).eq('last_run_status', 'success'),
    supabase.from('draymond_chains').select('id', { count: 'exact', head: true }).gte('updated_at', since).eq('status', 'completed'),
  ]);
  if (actions.error || jobs.error || chains.error) throw new Error('session count failed');
  return (actions.count ?? 0) + (jobs.count ?? 0) + (chains.count ?? 0);
}

// ============================================================================
// PHASE 1 — ORIENT: inventory memory
// ============================================================================

async function allMemories(): Promise<DraymondMemory[]> {
  const supabase = createDraymondAdminClient();
  const { data, error } = await supabase.from('draymond_memory').select('*').limit(1000);
  if (error) throw new Error(`orient: ${error.message}`);
  return (data ?? []) as DraymondMemory[];
}

async function orientPhase(): Promise<DreamPhaseCounts['oriented']> {
  const mems = await allMemories();
  const byTier: Record<string, number> = {};
  for (const m of mems) byTier[m.tier] = (byTier[m.tier] ?? 0) + 1;
  const staleCutoff = Date.now() - STALE_DAYS() * 86_400_000;
  const stale = mems.filter((m) => new Date(m.last_accessed_at).getTime() < staleCutoff).length;
  const keys = mems.map((m) => m.key);
  const duplicates = keys.length - new Set(keys).size;
  return { total: mems.length, byTier, stale, duplicates };
}

// ============================================================================
// PHASE 2 — GATHER: candidates since last dream (narrow event/outcome reads)
// ============================================================================

interface GatherResult {
  counts: DreamPhaseCounts['gathered'];
  duplicates: string[];
  contradicted: string[];
  recentEvents: Array<{ event_type: string; message: string }>;
}

async function readOutcomesSince(sinceIso: string): Promise<Array<{ createdAt?: string }>> {
  try {
    const raw = await fs.readFile(path.join(process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond'), 'learning-outcomes.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Array<{ createdAt?: string }>;
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr.filter((o) => (o.createdAt ? new Date(o.createdAt).getTime() >= new Date(sinceIso).getTime() : false));
  } catch {
    return [];
  }
}

async function gatherPhase(lastDreamAt: string | null): Promise<GatherResult> {
  const supabase = createDraymondAdminClient();
  const since = lastDreamAt ?? new Date(0).toISOString();
  const events = await supabase
    .from('draymond_events')
    .select('id, event_type, message, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(200)
    .then((r) => (r.data ?? []) as Array<{ event_type: string; message: string }>)
    .catch(() => []);
  const outcomes = await readOutcomesSince(since);
  const mems = await allMemories().catch(() => []);

  const byKey = new Map<string, DraymondMemory[]>();
  for (const m of mems) {
    const list = byKey.get(m.key) ?? [];
    list.push(m);
    byKey.set(m.key, list);
  }
  const duplicates = [...byKey.values()].filter((l) => l.length > 1).map((l) => l[0]!.key);
  const contradicted = [...byKey.values()]
    .filter((l) => l.length > 1 && new Set(l.map((m) => m.summary ?? '')).size > 1)
    .map((l) => l[0]!.key);
  const staleCutoff = Date.now() - STALE_DAYS() * 86_400_000;
  const staleKeys = [...new Set(mems.filter((m) => new Date(m.last_accessed_at).getTime() < staleCutoff).map((m) => m.key))];
  const lowValueKeys = [...new Set(mems.filter((m) => (m.importance_score ?? 0) < LOW_VALUE_FLOOR).map((m) => m.key))];

  return {
    counts: {
      events: events.length,
      outcomes: outcomes.length,
      duplicateKeys: duplicates.length,
      contradictedKeys: contradicted.length,
      staleKeys: staleKeys.length,
      lowValueKeys: lowValueKeys.length,
    },
    duplicates,
    contradicted,
    recentEvents: events,
  };
}

// ============================================================================
// PHASE 3 — CONSOLIDATE: merge, correct, promote, distill (memory-only writes)
// ============================================================================

async function consolidatePhase(gathered: GatherResult): Promise<DreamPhaseCounts['consolidated']> {
  const mems = await allMemories().catch(() => []);
  const byKey = new Map<string, DraymondMemory[]>();
  for (const m of mems) {
    const list = byKey.get(m.key) ?? [];
    list.push(m);
    byKey.set(m.key, list);
  }

  let mergedKeys = 0;
  let correctedKeys = 0;
  let promoted = 0;
  let lessonsStored = 0;

  // 1. Merge duplicate keys — storeMemory upserts on (agent_id, user_id, key),
  //    so one call collapses every duplicate row into the merged row.
  for (const key of gathered.duplicates) {
    const rows = byKey.get(key) ?? [];
    if (rows.length < 2) continue;
    const best = [...rows].sort((a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0))[0]!;
    const newest = [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]!;
    const mergedValue = Object.assign({}, ...rows.map((r) => r.value ?? {}));
    await storeMemory({
      agent_id: best.agent_id,
      user_id: best.user_id ?? undefined,
      key,
      value: { ...mergedValue, mergedFrom: rows.length, mergedAt: nowIso() },
      summary: newest.summary ?? best.summary ?? undefined,
      tier: best.tier,
      importance_score: Math.max(...rows.map((r) => r.importance_score ?? 0)),
      source_event: 'dream_merge',
    }).catch(() => {});
    mergedKeys += 1;
  }

  // 2. Correct contradicted summaries from the latest event (same-key conflicts).
  for (const key of gathered.contradicted) {
    const rows = byKey.get(key) ?? [];
    const best = [...rows].sort((a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0))[0];
    if (!best) continue;
    const latest = [...gathered.recentEvents].reverse().find((e) => (e.message ?? '').includes(key));
    await storeMemory({
      agent_id: best.agent_id,
      user_id: best.user_id ?? undefined,
      key,
      value: best.value ?? {},
      summary: latest ? `(corrected) ${latest.message.slice(0, 180)}` : best.summary ?? undefined,
      tier: best.tier,
      importance_score: best.importance_score,
      source_event: 'dream_correct',
    }).catch(() => {});
    correctedKeys += 1;
  }

  // 3. Promote high-value memories (tier/importance boost via re-store).
  const promote = mems.filter((m) => (m.importance_score ?? 0) >= PROMOTE_FLOOR && m.tier !== 'core');
  for (const m of promote) {
    await storeMemory({
      agent_id: m.agent_id,
      user_id: m.user_id ?? undefined,
      key: m.key,
      value: m.value ?? {},
      summary: m.summary ?? undefined,
      tier: 'important',
      importance_score: Math.min(1, (m.importance_score ?? 0) + 0.1),
      source_event: 'dream_promote',
    }).catch(() => {});
    promoted += 1;
  }

  // 4. Distill lessons into memories (reuse the existing lesson store).
  try {
    const lessons = (await getLessons()) ?? [];
    for (const l of lessons.slice(0, 10)) {
      await storeMemory({
        agent_id: 'draymond',
        user_id: 'system',
        key: `dream:lesson:${l.id}`,
        summary: l.lesson,
        value: { pattern: l.pattern, evidenceCount: l.evidenceCount },
        tier: 'contextual',
        importance_score: 0.5,
        source_event: 'dream_lesson',
      }).catch(() => {});
      lessonsStored += 1;
    }
  } catch {
    // best-effort
  }

  // 5. dream_completed marker row.
  await storeMemory({
    agent_id: 'draymond',
    user_id: 'system',
    key: 'dream:completed:last',
    summary: 'AutoDream consolidation completed',
    value: { completedAt: nowIso(), mergedKeys, correctedKeys, promoted },
    tier: 'contextual',
    importance_score: 0.4,
    source_event: 'dream_completed',
  }).catch(() => {});

  return { mergedKeys, correctedKeys, promoted, lessonsStored };
}

// ============================================================================
// PHASE 4 — PRUNE & INDEX: decay sweep + dream-index rewrite
// ============================================================================

async function prunePhase(): Promise<DreamPhaseCounts['pruned']> {
  const sweep = await runDecaySweep().catch(() => ({
    decayed: 0, expired: 0, total_scanned: 0, boosted: 0, sweep_duration_ms: 0, swept_at: nowIso(),
  }));
  const supabase = createDraymondAdminClient();
  try {
    await supabase.from('draymond_memory').delete().lt('importance_score', LOW_VALUE_FLOOR).eq('is_active', true).then(() => {});
  } catch {
    // best-effort
  }
  const mems = await allMemories().catch(() => []);
  const top = [...mems].sort((a, b) => (b.importance_score ?? 0) - (a.importance_score ?? 0)).slice(0, INDEX_CAP);
  const entries = top.map((m) => ({
    key: m.key,
    tier: m.tier,
    importance: m.importance_score ?? 0,
    summary: (m.summary ?? '').slice(0, 120),
  }));
  await storeMemory({
    agent_id: 'draymond',
    user_id: 'system',
    key: 'dream-index',
    summary: `Dream index: ${entries.length} top memories (compacted ${nowIso().slice(0, 10)})`,
    value: { entries, cap: INDEX_CAP },
    tier: 'core',
    importance_score: 1.0,
    source_event: 'dream_index',
  }).catch(() => {});
  return { decayed: sweep.decayed, expired: sweep.expired, indexEntries: entries.length };
}

// ============================================================================
// ORCHESTRATION
// ============================================================================

interface PhaseRun {
  phases: DreamPhaseCounts;
  entries: string[];
}

async function runPhases(lastDreamAt: string | null): Promise<PhaseRun> {
  const entries: string[] = [];
  let oriented: DreamPhaseCounts['oriented'] = emptyPhases().oriented;
  try {
    oriented = await orientPhase();
    entries.push(`oriented: ${oriented.total} memories (${Object.entries(oriented.byTier).map(([t, n]) => `${t}:${n}`).join(', ') || 'empty'})`);
  } catch (err) {
    entries.push(`oriented failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const gathered = await gatherPhase(lastDreamAt).catch(() => ({ counts: emptyPhases().gathered, duplicates: [], contradicted: [], recentEvents: [] }));
  entries.push(`gathered: ${gathered.counts.events} events, ${gathered.counts.outcomes} outcomes, ${gathered.counts.duplicateKeys} dup keys, ${gathered.counts.contradictedKeys} contradicted`);

  let consolidated: DreamPhaseCounts['consolidated'] = emptyPhases().consolidated;
  try {
    consolidated = await consolidatePhase(gathered);
    entries.push(`consolidated: merged ${consolidated.mergedKeys}, corrected ${consolidated.correctedKeys}, promoted ${consolidated.promoted}, ${consolidated.lessonsStored} lessons`);
  } catch (err) {
    entries.push(`consolidated failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let pruned: DreamPhaseCounts['pruned'] = emptyPhases().pruned;
  try {
    pruned = await prunePhase();
    entries.push(`pruned: ${pruned.decayed} decayed, ${pruned.expired} expired, index ${pruned.indexEntries} entries`);
  } catch (err) {
    entries.push(`pruned failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { phases: { oriented, gathered: gathered.counts, consolidated, pruned }, entries };
}

/**
 * Run the full dream cycle. Gates in order (cheapest → most expensive):
 * lock → time → sessions → idle. NEVER rejects — every path returns a report.
 */
export async function runDreamCycle(): Promise<DreamReport> {
  const started = Date.now();
  let state: DreamState;
  try {
    state = await readState();
  } catch {
    return { lastDreamAt: nowIso(), sessionsCounted: 0, phases: emptyPhases(), entries: [], durationMs: Date.now() - started, gatedBy: 'error', error: 'failed to read dream state' };
  }

  // Lock gate — steal stale locks (crashed runs).
  const lockedAt = state.lock.lockedAt ? new Date(state.lock.lockedAt).getTime() : 0;
  if (state.lock.locked && Date.now() - lockedAt < STALE_LOCK_MS) {
    return { ...emptyReport(state), gatedBy: 'lock', durationMs: Date.now() - started };
  }
  state.lock = { locked: true, lockedAt: nowIso() };
  await writeState(state).catch(() => {});

  try {
    // Time gate
    if (state.lastDreamAt && Date.now() - new Date(state.lastDreamAt).getTime() < MIN_HOURS() * 3_600_000) {
      return { ...emptyReport(state), gatedBy: 'time', durationMs: Date.now() - started };
    }

    // Sessions gate
    let sessions = 0;
    try {
      sessions = await countSessionsSince(state.lastDreamAt);
    } catch {
      return { ...emptyReport(state), gatedBy: 'error', error: 'session count failed', durationMs: Date.now() - started };
    }
    if (sessions < MIN_SESSIONS()) {
      return { ...emptyReport(state), sessionsCounted: sessions, gatedBy: 'sessions', durationMs: Date.now() - started };
    }

    // Idle gate (most expensive — last)
    let idle = true;
    try {
      const { isSystemIdle } = await import('./cognition');
      idle = await isSystemIdle();
    } catch {
      idle = true; // fail-open: idle is a cost gate, not a correctness gate
    }
    if (!idle) {
      return { ...emptyReport(state), sessionsCounted: sessions, gatedBy: 'idle', durationMs: Date.now() - started };
    }

    // Phases
    const run = await runPhases(state.lastDreamAt);
    const report: DreamReport = {
      lastDreamAt: nowIso(),
      sessionsCounted: sessions,
      phases: run.phases,
      entries: run.entries,
      durationMs: Date.now() - started,
    };
    const fresh = await readState().catch(() => state);
    fresh.lastDreamAt = report.lastDreamAt;
    fresh.sessionsCounted = sessions;
    fresh.reports = [report, ...(fresh.reports ?? [])].slice(0, 30);
    await writeState(fresh).catch(() => {});
    await logEvent({
      agent_id: 'draymond',
      category: 'memory',
      severity: 'info',
      event_type: 'dream_completed',
      message: `AutoDream completed: merged ${run.phases.consolidated.mergedKeys} keys, promoted ${run.phases.consolidated.promoted}, index ${run.phases.pruned.indexEntries}`,
      metadata: { durationMs: report.durationMs, sessionsCounted: sessions },
    }).catch(() => {});
    return report;
  } catch (err) {
    return { ...emptyReport(state), gatedBy: 'error', error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started };
  } finally {
    // Always release the lock.
    const s = await readState().catch(() => state);
    s.lock = { locked: false, lockedAt: null };
    await writeState(s).catch(() => {});
  }
}

/** Latest dream report + current state (dashboard surface). */
export async function dreamReport(): Promise<{ state: DreamState; latest: DreamReport | null }> {
  const state = await readState();
  return { state, latest: state.reports[0] ?? null };
}
