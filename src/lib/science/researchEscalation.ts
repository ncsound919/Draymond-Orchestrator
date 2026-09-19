/**
 * science/researchEscalation.ts — research-gap escalation pipeline.
 *
 * Gap records detected by sports_science/gap_detection.py (run through
 * run_gaps.py at the pythonExecutors choke point) are escalated here:
 *   - upserted into the draymond.db `science_gaps` table with a status
 *     lifecycle open -> researching -> resolved (unique gap_id, so a
 *     re-escalated gap updates its row instead of duplicating it),
 *   - appended into .draymond/hypotheses.json + .draymond/experiment-queue.json
 *     (append-only, hyp_/exp_-prefixed lowercase slugs; the files are re-read
 *     immediately before each write and skipped silently when absent),
 *   - dispatched to OmniResearch deep-research (OMNI_RESEARCH_URL, default
 *     http://127.0.0.1:3010) — offline degrades honestly to queued:true with
 *     the row left open so nothing is ever lost.
 *
 * Follows the trendsFeed conventions: TEXT ids, JSON-as-TEXT payload,
 * ISO-8601 UTC timestamps, fail-soft everywhere.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@/lib/db/connection';

export const GAP_STATUSES = ['open', 'researching', 'resolved'] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

export interface GapRecord {
  gap_id: string;
  kind: string;
  title: string;
  detail?: string;
  source_ref?: string;
  evidence_tier?: string;
  severity?: number;
  detected_at?: string;
}

export interface StoredGap extends GapRecord {
  status: GapStatus;
  payload: Record<string, unknown>;
  dispatched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EscalateMeta {
  /** Domain tag for generated experiment-queue entries. Defaults to 'sports'. */
  domain?: string;
  /**
   * Override for the .draymond brain dir. Defaults to DRAYMOND_REGISTRY_DIR or
   * <cwd>/.draymond. Tests pin this to a temp dir; real brain files are never
   * written otherwise.
   */
  brainDir?: string;
}

export interface EscalationResult {
  ok: boolean;
  escalated: number;
  duplicates: number;
  hypothesesAppended: number;
  experimentsAppended: number;
  errors: string[];
}

export interface DispatchResult {
  ok: boolean;
  /** True when the task was queued locally because OmniResearch is unreachable. */
  queued?: boolean;
  status?: GapStatus;
  error?: string;
}

export interface TransitionResult {
  ok: boolean;
  gap?: StoredGap;
  error?: string;
}

const TABLE = 'science_gaps';
const GAP_GOAL_ID = 'science-gaps';

function brainDir(override?: string): string {
  return (
    override ??
    process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond')
  );
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'untitled';
}

/** Structural check of a python-detected gap record. */
export function isValidGap(r: unknown): r is GapRecord {
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return false;
  const g = r as Record<string, unknown>;
  return (
    typeof g.gap_id === 'string' &&
    !!g.gap_id.trim() &&
    typeof g.kind === 'string' &&
    typeof g.title === 'string' &&
    !!g.title.trim()
  );
}

/**
 * Upsert gap rows into science_gaps and append research-brain entries.
 * Idempotent on gap_id: re-escalating an existing gap refreshes its mutable
 * fields but never duplicates the row nor the brain entries. Never throws —
 * per-record problems land in errors[].
 */
export async function escalateGaps(
  records: unknown[],
  meta: EscalateMeta = {},
): Promise<EscalationResult> {
  const result: EscalationResult = {
    ok: true,
    escalated: 0,
    duplicates: 0,
    hypothesesAppended: 0,
    experimentsAppended: 0,
    errors: [],
  };
  if (!Array.isArray(records) || records.length === 0) {
    result.errors.push('records must be a non-empty array');
    result.ok = false;
    return result;
  }

  try {
    const db = getDb();
    const now = new Date().toISOString();
    for (const raw of records.slice(0, 100)) {
      if (!isValidGap(raw)) {
        result.errors.push('invalid gap record shape');
        continue;
      }
      const gap = raw as GapRecord;
      const payload = { ...gap } as Record<string, unknown>;
      const severity = Number.isFinite(gap.severity)
        ? Math.max(1, Math.min(5, Math.round(Number(gap.severity))))
        : 3;
      const tier = typeof gap.evidence_tier === 'string' ? gap.evidence_tier : 'E3';
      try {
        const existing = db
          .prepare(`SELECT gap_id FROM ${TABLE} WHERE gap_id = ?`)
          .get(gap.gap_id) as { gap_id: string } | undefined;
        if (existing) {
          db.prepare(
            `UPDATE ${TABLE} SET title = ?, detail = ?, source_ref = ?, evidence_tier = ?, severity = ?, payload = ?, updated_at = ? WHERE gap_id = ?`,
          ).run(gap.title, gap.detail ?? null, gap.source_ref ?? null, tier, severity,
            JSON.stringify(payload), now, gap.gap_id);
          result.duplicates += 1;
        } else {
          db.prepare(
            `INSERT INTO ${TABLE} (gap_id, kind, title, detail, source_ref, evidence_tier, severity, status, payload, detected_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
          ).run(gap.gap_id, gap.kind, gap.title, gap.detail ?? null, gap.source_ref ?? null,
            tier, severity, JSON.stringify(payload), gap.detected_at ?? now, now, now);
          result.escalated += 1;

          // Brain append rides only NEW gaps so idempotent re-runs never spam.
          const slug = `${slugify(gap.kind)}-${slugify(gap.title)}`;
          const hypothesisId = `hyp_${slug}`;
          const experimentId = `exp_${slug}`;
          if (appendBrainEntry('hypotheses.json', 'hypotheses', meta.brainDir, {
            claim: gap.detail || gap.title,
            status: 'untested',
            id: hypothesisId,
            goal_id: GAP_GOAL_ID,
            experiment_ids: [],
            updatedAt: now,
          })) result.hypothesesAppended += 1;
          if (appendBrainEntry('experiment-queue.json', 'queue', meta.brainDir, {
            goal_id: GAP_GOAL_ID,
            hypothesis_id: hypothesisId,
            domain: meta.domain ?? 'sports',
            type: 'analysis',
            model_id: 'omniresearch-deep-research',
            inputs: { gap_id: gap.gap_id, kind: gap.kind, source_ref: gap.source_ref ?? null },
            id: experimentId,
            status: 'queued',
            createdAt: now,
          })) result.experimentsAppended += 1;
        }
      } catch (err) {
        result.errors.push(`${gap.gap_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    result.ok = result.errors.length === 0;
    return result;
  } catch (err) {
    result.ok = false;
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
}

/**
 * Append one entry to a .draymond brain JSON file ({<arrayKey>: [...]}).
 * The file is re-read immediately before writing so concurrent fleet writers
 * are preserved; entries dedup on id; absent files are skipped silently.
 * Returns true when an entry was actually appended.
 */
function appendBrainEntry(
  file: string,
  arrayKey: string,
  dirOverride: string | undefined,
  entry: Record<string, unknown>,
): boolean {
  try {
    const filePath = /*turbopackIgnore: true*/ path.join(brainDir(dirOverride), file);
    if (!/*turbopackIgnore: true*/ fs.existsSync(filePath)) return false;
    const parsed = JSON.parse(/*turbopackIgnore: true*/ fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    const arr = Array.isArray(parsed[arrayKey]) ? (parsed[arrayKey] as unknown[]) : [];
    if (arr.some((e) => (e as Record<string, unknown>)?.id === entry.id)) return false;
    parsed[arrayKey] = [...arr, entry];
    parsed.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2));
    return true;
  } catch {
    // Brain writes are best-effort by contract; never break escalation.
    return false;
  }
}

/**
 * Latest gaps (newest updated first), optionally filtered by status/kind.
 * Degrades to [] when the store is unreadable — mirroring listInsights.
 */
export async function listGaps(
  filter: { status?: string; kind?: string; limit?: number } = {},
): Promise<StoredGap[]> {
  try {
    const limit = Math.max(1, Math.min(500, filter.limit ?? 50));
    const db = getDb();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter.kind) {
      clauses.push('kind = ?');
      params.push(filter.kind);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT * FROM ${TABLE} ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...(row as unknown as StoredGap),
      payload: (() => {
        try {
          return JSON.parse(String(row.payload)) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
    }));
  } catch {
    return [];
  }
}

const OPS: Record<'research' | 'resolve', GapStatus> = {
  research: 'researching',
  resolve: 'resolved',
};

/** Move a gap through the lifecycle: research -> researching, resolve -> resolved. */
export async function transitionGap(id: string, op: 'research' | 'resolve'): Promise<TransitionResult> {
  const next = OPS[op];
  if (!next) return { ok: false, error: `unknown op: ${String(op)} (expected research|resolve)` };
  try {
    const db = getDb();
    const res = db
      .prepare(
        `UPDATE ${TABLE} SET status = ?, dispatched_at = COALESCE(?, dispatched_at), updated_at = ? WHERE gap_id = ? RETURNING *`,
      )
      .get(next, op === 'research' ? new Date().toISOString() : null, new Date().toISOString(), id) as
      | Record<string, unknown>
      | undefined;
    if (!res) return { ok: false, error: `unknown gap: ${id}` };
    return {
      ok: true,
      gap: {
        ...(res as unknown as StoredGap),
        payload: JSON.parse(String(res.payload ?? '{}')) as Record<string, unknown>,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function omniResearchUrl(): string {
  const base = process.env.OMNI_RESEARCH_URL ?? 'http://127.0.0.1:3010';
  return `${base.replace(/\/+$/, '')}/deep-research`;
}

/**
 * POST one gap to OmniResearch as a deep-research task. Offline / unreachable /
 * non-2xx responses degrade to {ok:false, queued:true} and leave the row open —
 * a gap is never lost to a dispatch failure.
 */
export async function dispatchToResearch(gap: StoredGap): Promise<DispatchResult> {
  try {
    const res = await fetch(omniResearchUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'deep_research', gap }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { ok: false, queued: true, error: `omni responded ${res.status}` };
    }
    const transitioned = await transitionGap(gap.gap_id, 'research');
    if (!transitioned.ok) return { ok: false, queued: true, error: transitioned.error };
    return { ok: true, status: 'researching' };
  } catch (err) {
    return { ok: false, queued: true, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface DrainResult {
  ok: boolean;
  dispatched: number;
  queued: number;
  errors: string[];
  reason?: string;
}

/**
 * Scheduler step: drain open gaps through dispatchToResearch. Fail-soft like
 * every research-loop step — an empty queue or unreachable OmniResearch is
 * recorded, never thrown.
 */
export async function drainOpenGaps(limit = 5): Promise<DrainResult> {
  const result: DrainResult = { ok: true, dispatched: 0, queued: 0, errors: [] };
  try {
    const open = await listGaps({ status: 'open', limit });
    for (const gap of open) {
      const r = await dispatchToResearch(gap);
      if (r.ok) result.dispatched += 1;
      else {
        result.queued += 1;
        if (r.error) result.errors.push(`${gap.gap_id}: ${r.error}`);
      }
    }
    return result;
  } catch (err) {
    result.ok = false;
    result.reason = err instanceof Error ? err.message : String(err);
    return result;
  }
}
