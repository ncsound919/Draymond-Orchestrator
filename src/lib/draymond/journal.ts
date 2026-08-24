import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'draymond-events.db');

export interface JournalEntryInput {
  file: string;
  op: string;
  actor: string;
  content: string;
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      file TEXT NOT NULL,
      op TEXT NOT NULL,
      actor TEXT NOT NULL,
      content TEXT NOT NULL,
      content_sha256 TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_file ON events(file, id);
  `);
  return db;
}

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Journal an event row BEFORE the caller performs the JSON write.
 *  payload is the FULL post-write file content so recovery is exact. */
export function journalWrite(input: JournalEntryInput): void {
  const digest = sha256(input.content);
  getDb()
    .prepare(
      'INSERT INTO events (ts, file, op, actor, content, content_sha256) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(new Date().toISOString(), input.file, input.op, input.actor, input.content, digest);
}

/** Atomic JSON write through the journal: journal first (WAL commit), then
 *  temp-file + rename so readers never see partial content. */
export function writeBrainFile(
  filePath: string,
  content: string,
  op: string,
  actor = 'unknown'
): void {
  journalWrite({ file: path.basename(filePath), op, actor, content });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
}

/** Rebuild a brain file from the latest journaled content. Returns the recovered
 *  content or null when the file has no journal history. */
export function recoverBrainFile(fileName: string): string | null {
  const row = getDb()
    .prepare('SELECT content, content_sha256 FROM events WHERE file = ? ORDER BY id DESC LIMIT 1')
    .get(fileName) as { content: string; content_sha256: string } | undefined;
  if (!row) return null;
  const digest = sha256(row.content);
  if (digest !== row.content_sha256) {
    throw new Error(`journal integrity failure for ${fileName}: sha256 mismatch`);
  }
  const target = path.join(BRAIN_DIR, fileName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, row.content, 'utf-8');
  fs.renameSync(tmp, target);
  return row.content;
}

export function listJournaledFiles(): Array<{ file: string; events: number; lastTs: string }> {
  return getDb()
    .prepare(
      'SELECT file, COUNT(*) as events, MAX(ts) as lastTs FROM events GROUP BY file ORDER BY file'
    )
    .all() as Array<{ file: string; events: number; lastTs: string }>;
}

const BRAIN_DIR = process.env.DRAYMOND_BRAIN_DIR || path.join(process.cwd(), '.draymond');

/** Nightly compaction: atomically snapshot each file's latest state into
 *  data/journal-snapshots/, then truncate journal rows superseded by it. */
export function compactJournal(): { snapshotted: number; truncated: number } {
  const d = getDb();
  const files = d
    .prepare('SELECT DISTINCT file FROM events')
    .all() as Array<{ file: string }>;
  const snapshotDir = path.join(DB_DIR, 'journal-snapshots');
  let snapshotted = 0;
  let truncated = 0;

  for (const { file } of files) {
    const latest = d
      .prepare('SELECT id, content, content_sha256 FROM events WHERE file = ? ORDER BY id DESC LIMIT 1')
      .get(file) as { id: number; content: string; content_sha256: string } | undefined;
    if (!latest) continue;
    fs.mkdirSync(snapshotDir, { recursive: true });
    const snapPath = path.join(snapshotDir, `${file}.snapshot.json`);
    const tmp = `${snapPath}.tmp-${process.pid}`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ file, eventId: latest.id, sha256: latest.content_sha256 }, null, 2),
      'utf-8'
    );
    fs.renameSync(tmp, snapPath);
    // Only truncate AFTER the atomic rename succeeded.
    const res = d.prepare('DELETE FROM events WHERE file = ? AND id < ?').run(file, latest.id);
    truncated += res.changes;
    snapshotted++;
  }
  return { snapshotted, truncated };
}
