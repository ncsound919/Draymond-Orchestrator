// ============================================================================
// DRAYMOND AGENT IDE — session memory (layered, SQLite FTS5)
// ============================================================================
// TencentDB-Agent-Memory-inspired, Docker-free: memory is stored as reusable
// assets (L1 facts / L2 scenario blocks / L3 team profile) in a local SQLite
// file with a real full-text (FTS5, porter) index + BM25 ranking — no server,
// no containers, no cloud.
//
//   L1 — facts: distilled outcome of a completed session.
//   L2 — scenario: context blocks grouped around a workspace/goal.
//   L3 — team profile: fed from the self-learning lesson store (getLessons).
//
// Retrieval is BM25 over the FTS index (falling back to L1/L2 on recall), and
// seeding pulls L3 team lessons alongside so the plan is grounded in what the
// team already learned. The asset schema (type / layer / scope / owner) keeps
// room for Skill / Wiki / CodeGraph assets later.
// ============================================================================

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import * as vec from 'sqlite-vec';
import type { IdeSession } from './types';
import { getLessons } from '../draymond/self-learning';
import type { Lesson } from '../draymond/self-learning';
import { embedTexts, embeddingsEnabled } from './embeddings';

export type MemoryAssetType = 'memory' | 'skill' | 'wiki' | 'codegraph';
export type MemoryLayer = 'l1' | 'l2' | 'l3';
export type MemoryScope = 'team' | 'private';

export interface IdeMemoryRecord {
  id: string;
  type: MemoryAssetType;
  layer: MemoryLayer;
  scope: MemoryScope;
  owner: string;
  goal: string;
  summary: string;
  stepSummary: string;
  review: string;
  note?: string;
  createdAt: string;
}

export interface MemorySearchHit {
  record: IdeMemoryRecord;
  score: number;
}

export interface MemorySeed {
  memories: MemorySearchHit[];
  lessons: Lesson[];
}

// -- SQLite (FTS5) store, one handle per db file -----------------------------

const handles = new Map<string, Database.Database>();

/** Resolved lazily so tests (fresh temp dirs per case) and prod both work. */
function memoryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond');
}

function dbFile(): string {
  return path.join(memoryDir(), 'ide-memory.db');
}

function getDb(): Database.Database {
  const file = dbFile();
  let db = handles.get(file);
  if (db) return db;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  try {
    db.loadExtension(vec.getLoadablePath());
  } catch {
    // sqlite-vec unavailable — vector layer degrades off
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_assets (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      layer       TEXT NOT NULL,
      scope       TEXT NOT NULL,
      owner       TEXT NOT NULL,
      goal        TEXT NOT NULL,
      summary     TEXT NOT NULL,
      step_summary TEXT NOT NULL DEFAULT '',
      review      TEXT NOT NULL DEFAULT '',
      note        TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      asset_id UNINDEXED,
      goal,
      body,
      tokenize = 'porter'
    );
  `);
  try {
    db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(embedding float[384])');
  } catch {
    // vector table unavailable (sqlite-vec not loaded) — degrade
  }
  handles.set(file, db);
  return db;
}

// -- Helpers -----------------------------------------------------------------

function reviewLine(session: IdeSession): string {
  const r = session.review;
  if (!r) return 'no review gate result';
  if (r.score == null) return `${r.scorer} — ${r.summary}`;
  return `${r.scorer} ${r.score}/${r.gateThreshold} ${r.passed ? 'passed' : 'failed'} — ${r.summary}`;
}

function stepLine(session: IdeSession): string {
  return session.steps.map((s) => `${s.title}(${s.status})`).join(', ');
}

/** FTS-safe query: alphanumeric tokens quoted and OR-joined. */
function toMatchQuery(query: string): string | null {
  const tokens = (query.toLowerCase().match(/[a-z0-9_]+/g) ?? []).map((t) => `"${t.replace(/"/g, '""')}"`);
  return tokens.length > 0 ? tokens.join(' OR ') : null;
}

function toRecord(row: Record<string, unknown>): IdeMemoryRecord {
  return {
    id: String(row.id),
    type: (row.type ?? 'memory') as MemoryAssetType,
    layer: (row.layer ?? 'l1') as MemoryLayer,
    scope: (row.scope ?? 'team') as MemoryScope,
    owner: String(row.owner ?? ''),
    goal: String(row.goal ?? ''),
    summary: String(row.summary ?? ''),
    stepSummary: String(row.step_summary ?? ''),
    review: String(row.review ?? ''),
    note: row.note == null ? undefined : String(row.note),
    createdAt: String(row.created_at ?? ''),
  };
}

// -- Public API --------------------------------------------------------------

/**
 * Distill a completed session into L1 (facts) + L2 (scenario) memory assets.
 * Fail-soft: memory issues must never break the session that just finished.
 */
export async function recordSessionMemory(session: IdeSession): Promise<IdeMemoryRecord | null> {
  try {
    const db = getDb();
    const done = session.steps.filter((s) => s.status === 'done').length;
    const failed = session.steps.filter((s) => s.status === 'failed').length;
    const ts = new Date().toISOString();

    const l1: IdeMemoryRecord = {
      id: `${session.id}-l1`,
      type: 'memory',
      layer: 'l1',
      scope: 'team',
      owner: session.crew?.lead ?? 'ide',
      goal: session.goal,
      summary: `${done}/${session.steps.length} steps done, ${failed} failed`,
      stepSummary: stepLine(session),
      review: reviewLine(session),
      note: session.note,
      createdAt: ts,
    };
    const l2: IdeMemoryRecord = {
      ...l1,
      id: `${session.id}-l2`,
      layer: 'l2',
      owner: session.workspace ? `workspace:${session.workspace}` : 'ide',
      summary: `scenario for "${session.goal.slice(0, 80)}"${session.workspace ? ` in ${session.workspace}` : ''} — ${done}/${session.steps.length} steps done`,
    };

    const insert = db.prepare(
      `INSERT OR REPLACE INTO memory_assets (id, type, layer, scope, owner, goal, summary, step_summary, review, note, created_at)
       VALUES (@id, @type, @layer, @scope, @owner, @goal, @summary, @stepSummary, @review, @note, @createdAt)`,
    );
    const insertFts = db.prepare(`INSERT OR REPLACE INTO memory_fts (asset_id, goal, body) VALUES (?, ?, ?)`);
    const tx = db.transaction((records: IdeMemoryRecord[]) => {
      for (const r of records) {
        insert.run(r);
        insertFts.run(r.id, r.goal, `${r.goal} ${r.summary} ${r.stepSummary} ${r.review} ${r.note ?? ''}`);
      }
    });
    tx([l1, l2]);

    // Vector layer (sqlite-vec + local embeddings) — optional, fail-soft.
    if (embeddingsEnabled()) {
      const bodies = [l1, l2].map((r) => `${r.goal} ${r.summary} ${r.stepSummary} ${r.review} ${r.note ?? ''}`);
      const vectors = await embedTexts(bodies);
      if (vectors && vectors.length === bodies.length) {
        const rowid = db.prepare('SELECT rowid FROM memory_assets WHERE id = ?');
        const insertVec = db.prepare('INSERT OR REPLACE INTO memory_vec(rowid, embedding) VALUES (?, ?)');
        for (let i = 0; i < bodies.length; i++) {
          const rid = rowid.get([l1, l2][i].id) as { rowid: number } | undefined;
          if (rid) insertVec.run(rid.rowid, JSON.stringify(vectors[i]));
        }
      }
    }
    return l1;
  } catch {
    return null;
  }
}

/** Hybrid retrieval: FTS5 BM25 + (when enabled) sqlite-vec, fused with RRF. */
export async function searchSessionMemory(query: string, limit = 3): Promise<MemorySearchHit[]> {
  try {
    const match = toMatchQuery(query);
    if (!match) return [];
    const db = getDb();

    const ftsRows = db
      .prepare(
        `SELECT a.rowid AS rid, a.*, bm25(memory_fts) AS score
         FROM memory_fts JOIN memory_assets a ON a.id = memory_fts.asset_id
         WHERE memory_fts MATCH ?
         ORDER BY score LIMIT ?`,
      )
      .all(match, limit * 4) as Array<Record<string, unknown>>;

    // Vector retrieval (optional).
    let vecHits: Array<{ rid: number; distance: number }> = [];
    let vecOk = false;
    if (embeddingsEnabled()) {
      const q = await embedTexts([query]);
      if (q) {
        try {
          vecHits = db
            .prepare('SELECT rowid AS rid, distance FROM memory_vec WHERE embedding MATCH ? AND k = 24')
            .all(JSON.stringify(q[0])) as Array<{ rid: number; distance: number }>;
          vecOk = vecHits.length > 0;
        } catch {
          vecOk = false;
        }
      }
    }

    if (ftsRows.length === 0 && !vecOk) return [];

    // RRF fusion of the two rankings.
    const rrf = new Map<number, { record: IdeMemoryRecord; rrf: number; ftsScore: number; dist?: number }>();
    ftsRows.forEach((row, i) => {
      const rid = Number(row.rid);
      rrf.set(rid, { record: toRecord(row), rrf: 1 / (60 + i + 1), ftsScore: Number(row.score ?? 0) });
    });
    vecHits.forEach((h, i) => {
      const existing = rrf.get(h.rid);
      if (existing) existing.rrf += 1 / (60 + i + 1);
      else {
        const row = db.prepare('SELECT * FROM memory_assets WHERE rowid = ?').get(h.rid) as Record<string, unknown>;
        if (row) rrf.set(h.rid, { record: toRecord(row), rrf: 1 / (60 + i + 1), ftsScore: 0, dist: h.distance });
      }
    });

    return [...rrf.values()]
      .sort((a, b) => b.rrf - a.rrf)
      .slice(0, limit)
      .map((v) => ({ record: v.record, score: v.ftsScore }));
  } catch {
    return [];
  }
}

/**
 * Build the seed context for a plan: relevant L1/L2 memories (BM25) plus L3
 * team lessons from the self-learning store. Never throws.
 */
export async function getMemorySeed(query: string, memoryLimit = 3, lessonLimit = 2): Promise<MemorySeed> {
  const [memories, lessons] = await Promise.all([
    searchSessionMemory(query, memoryLimit).catch(() => []),
    getLessons().catch(() => []),
  ]);
  return { memories, lessons: lessons.slice(0, lessonLimit) };
}
