/**
 * science/trendsFeed.ts — bbtech InsightReport persistence into draymond.db.
 *
 * The translation layer's InsightReports (science_bridge.insights.synthesize,
 * surfaced through runPythonInsights) are the fleet's cross-domain science
 * signal. This module persists them into the `science_insights` SQLite table
 * following the draymond.db conventions (TEXT ids, JSON-as-TEXT payloads,
 * ISO-8601 UTC timestamps) so trends/insights consumers read one store.
 *
 * Idempotency: unique on (source, session_id, generated_at) — a second
 * persistInsightReport call with the same key UPDATES the row instead of
 * duplicating it and reports duplicate:true (mirrors the upsertDiscovery
 * dedupe pattern in learning-store).
 *
 * Honesty: an invalid report fails with {ok:false,error} and nothing is
 * fabricated; a missing/unopenable database degrades to {ok:false,error} so
 * callers (route, executor choke point, scheduler loop) never crash on storage.
 */

import { createHash } from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@/lib/db/connection';
import { runPythonInsights } from '@/lib/sports/pythonExecutors';

export const EVIDENCE_TIERS = ['E1', 'E2', 'E3', 'E4'] as const;
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

export interface PersistMeta {
  /** Producer tag. Defaults to 'bbtech'. */
  source?: string;
  /** Session/run correlation id. Empty string for ad-hoc runs. */
  sessionId?: string;
  /** Domain of the source profile. Defaults to report.from_domain. */
  domain?: string;
  /** Executor-reported tier override; falls back to report.evidence_tier. */
  evidenceTier?: string;
  /** Report generation timestamp; defaults to now. Part of the idempotency key. */
  generatedAt?: string;
  /**
   * Additive row tag for non-InsightReport producers (Metrics Lab). When set
   * to 'derived', the payload is validated against the derived-metrics shape
   * ({metrics: [{name, ...}]}) instead of the InsightReport shape and the
   * stored report JSON is stamped with metric_kind.
   */
  metricKind?: string;
}

export interface PersistResult {
  ok: boolean;
  id?: string;
  duplicate?: boolean;
  error?: string;
}

export interface StoredInsight {
  id: string;
  source: string;
  session_id: string;
  domain: string;
  report: Record<string, unknown>;
  evidence_tier: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

const TABLE = 'science_insights';

function isTier(v: unknown): v is EvidenceTier {
  return typeof v === 'string' && (EVIDENCE_TIERS as readonly string[]).includes(v);
}

/** Structural validation of an InsightReport-shaped payload. Returns an error message or null. */
function validateReport(report: unknown, metricKind?: string): string | null {
  if (typeof report !== 'object' || report === null || Array.isArray(report)) {
    return 'report must be a non-empty InsightReport object';
  }
  const r = report as Record<string, unknown>;
  // Derived-metrics payloads (Metrics Lab) carry a metrics array instead of
  // from_domain/to_domain/translated_metrics; accept them only when the caller
  // explicitly tags the row as derived so raw insight validation stays strict.
  if (metricKind === 'derived') {
    if (!Array.isArray(r.metrics)) {
      return 'derived report.metrics must be an array';
    }
    if (!r.metrics.every((m) => typeof m === 'object' && m !== null && typeof (m as Record<string, unknown>).name === 'string')) {
      return 'each report.metrics entry must be an object with a name';
    }
    return null;
  }
  if (typeof r.from_domain !== 'string' || !r.from_domain) {
    return 'report.from_domain is required';
  }
  if (typeof r.to_domain !== 'string' || !r.to_domain) {
    return 'report.to_domain is required';
  }
  if (!Array.isArray(r.translated_metrics)) {
    return 'report.translated_metrics must be an array';
  }
  if (typeof r.confidence !== 'number' || !Number.isFinite(r.confidence)) {
    return 'report.confidence must be a number';
  }
  return null;
}

/**
 * Persist one InsightReport into the science_insights trends store.
 * Idempotent on (source, sessionId, generatedAt): the second call updates the
 * existing row and returns duplicate:true. Never throws — storage failures
 * degrade to {ok:false,error}.
 */
export async function persistInsightReport(
  report: unknown,
  meta: PersistMeta = {},
): Promise<PersistResult> {
  try {
    const invalid = validateReport(report, meta.metricKind);
    if (invalid) return { ok: false, error: invalid };
    const r = report as Record<string, unknown>;

    // Evidence-tier passthrough: meta override wins, then the report's own
    // graded tier, then the E3 rule-based default. Invalid tiers fail honestly.
    const tierRaw = meta.evidenceTier ?? r.evidence_tier ?? 'E3';
    if (!isTier(tierRaw)) {
      return { ok: false, error: `invalid evidence_tier: ${String(tierRaw)} (expected E1-E4)` };
    }

    const source = meta.source?.trim() || 'bbtech';
    const sessionId = meta.sessionId?.trim() ?? '';
    const domain = meta.domain?.trim() || (typeof r.from_domain === 'string' ? r.from_domain : '');
    const generatedAt = meta.generatedAt?.trim() || new Date().toISOString();
    // Deterministic id derived from the idempotency key so re-persisted rows
    // are addressable without a lookup round-trip.
    const id = `si_${createHash('sha256').update(`${source}:${sessionId}:${generatedAt}`).digest('hex').slice(0, 24)}`;
    const now = new Date().toISOString();
    const db = getDb();

    const existing = db
      .prepare(
        `SELECT id FROM ${TABLE} WHERE source = ? AND session_id = ? AND generated_at = ?`,
      )
      .get(source, sessionId, generatedAt) as { id: string } | undefined;

    // Additive row tag: derived rows carry metric_kind inside the stored
    // report JSON so trend queries can separate raw vs lab-generated stats.
    const stored: Record<string, unknown> = meta.metricKind ? { ...r, metric_kind: meta.metricKind } : r;

    if (existing) {
      db.prepare(
        `UPDATE ${TABLE} SET domain = ?, report = ?, evidence_tier = ?, updated_at = ? WHERE id = ?`,
      ).run(domain, JSON.stringify(stored), tierRaw, now, existing.id);
      return { ok: true, id: existing.id, duplicate: true };
    }

    db.prepare(
      `INSERT INTO ${TABLE} (id, source, session_id, domain, report, evidence_tier, generated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, source, sessionId, domain, JSON.stringify(stored), tierRaw, generatedAt, now, now);
    return { ok: true, id, duplicate: false };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Latest persisted insights (newest generated_at first). Degrades to [] when
 * the store is unreadable — mirroring listDiscoveries' fail-soft contract.
 */
export async function listInsights(
  opts: { source?: string; limit?: number } = {},
): Promise<StoredInsight[]> {
  try {
    const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
    const db = getDb();
    const rows = (
      opts.source
        ? db
            .prepare(
              `SELECT * FROM ${TABLE} WHERE source = ? ORDER BY generated_at DESC LIMIT ?`,
            )
            .all(opts.source, limit)
        : db.prepare(`SELECT * FROM ${TABLE} ORDER BY generated_at DESC LIMIT ?`).all(limit)
    ) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...(row as unknown as StoredInsight),
      report: (() => {
        try {
          return JSON.parse(String(row.report)) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// Scheduler hook: bbtech insight synthesis + persistence inside research_grade_loop
// ============================================================================

export interface BbtechInsightSyncResult {
  ok: boolean;
  profilesFound: number;
  synthesized: number;
  persisted: number;
  duplicates: number;
  errors: string[];
  reason?: string;
}

/**
 * Synthesize InsightReports over the real NBA dataset profiles (the same
 * datasets sports-pipeline.ingestNbaStats feeds the metrics pipeline) and let
 * the runPythonInsights choke point persist each successful report into the
 * trends store with source='bbtech'.
 *
 * Deterministic inputs, rule-based synthesis, no LLM. Fail-soft like every
 * scheduler step: python unavailable or a bad profile is recorded, never thrown.
 */
export async function syncBbtechInsights(limit = 3): Promise<BbtechInsightSyncResult> {
  const result: BbtechInsightSyncResult = {
    ok: false,
    profilesFound: 0,
    synthesized: 0,
    persisted: 0,
    duplicates: 0,
    errors: [],
  };
  const root = process.env.SPORTS_ROOT
    ? process.env.SPORTS_ROOT
    : path.resolve(/* turbopackIgnore: true */ process.cwd());
  const profilesDir = path.join(root, 'datasets', 'sports', 'nba', 'profiles');
  let files: string[] = [];
  try {
    files = fs.readdirSync(profilesDir).filter((f) => f.endsWith('.json'));
  } catch {
    return { ...result, reason: 'NBA dataset profiles not found' };
  }
  result.profilesFound = files.length;

  for (const file of files.slice(0, Math.max(1, limit))) {
    try {
      const profile = JSON.parse(fs.readFileSync(path.join(profilesDir, file), 'utf-8')) as Record<string, unknown>;
      const res = await runPythonInsights(profile);
      if (!res.success) {
        result.errors.push(`${file}: ${res.error ?? 'synthesis failed'}`);
        continue;
      }
      result.synthesized += 1;
      if (res.persisted?.ok) {
        result.persisted += 1;
        if (res.persisted.duplicate) result.duplicates += 1;
      } else {
        result.errors.push(`${file}: ${res.persisted?.error ?? 'persistence skipped'}`);
      }
    } catch (err) {
      result.errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  result.ok = result.persisted > 0 || result.errors.length === 0;
  if (!result.ok && result.errors.length > 0) result.reason = result.errors[0];
  return result;
}
