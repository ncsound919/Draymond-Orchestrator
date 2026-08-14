// ============================================================================
// Local SQLite connection (better-sqlite3)
// ============================================================================
// Single-file database, WAL mode, foreign keys on. The database file lives at
// process.env.DRAYMOND_DB_PATH or ./data/draymond.db. In-memory mode is used
// by tests (DRAYMOND_DB_PATH=':memory:').
// ============================================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema';

export type Db = Database.Database;

let cached: Db | null = null;

/** Columns added to existing tables after their initial CREATE TABLE. */
const SCHEMA_UPGRADES: Array<{ table: string; column: string; ddl: string }> = [
  {
    table: 'draymond_messages',
    column: 'seq',
    ddl: 'ALTER TABLE draymond_messages ADD COLUMN seq INTEGER NOT NULL DEFAULT 0',
  },
  {
    table: 'draymond_benchmarks',
    column: 'deep_scores',
    ddl: 'ALTER TABLE draymond_benchmarks ADD COLUMN deep_scores TEXT NOT NULL DEFAULT \'{}\'',
  },
  {
    table: 'draymond_scheduled_jobs',
    column: 'lease_expires_at',
    ddl: 'ALTER TABLE draymond_scheduled_jobs ADD COLUMN lease_expires_at TEXT',
  },
  {
    table: 'draymond_chains',
    column: 'lease_expires_at',
    ddl: 'ALTER TABLE draymond_chains ADD COLUMN lease_expires_at TEXT',
  },
];

/**
 * Apply non-destructive upgrades to an existing database file. `CREATE TABLE IF
 * NOT EXISTS` only creates missing tables — it never adds columns to tables that
 * already exist — so additive columns must be back-filled here.
 */
export function applyUpgrades(db: Db): void {
  const cols = db.prepare('PRAGMA table_info(draymond_benchmarks)').all() as Array<{ name: string }>;
  const have = new Set(cols.map((c) => c.name));
  for (const upgrade of SCHEMA_UPGRADES) {
    if (upgrade.table === 'draymond_benchmarks' && have.has(upgrade.column)) continue;
    const tableExists = !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(upgrade.table);
    if (!tableExists) continue; // table doesn't exist yet — nothing to upgrade
    const existing = db
      .prepare(`PRAGMA table_info(${upgrade.table})`)
      .all() as Array<{ name: string }>;
    const hasColumn = existing.some((c) => c.name === upgrade.column);
    if (hasColumn) continue;
    db.exec(upgrade.ddl);
  }
}

export function dbPath(): string {
  if (process.env.DRAYMOND_DB_PATH) return process.env.DRAYMOND_DB_PATH;
  return path.join(process.cwd(), 'data', 'draymond.db');
}

export function getDb(): Db {
  if (cached) return cached;

  const file = dbPath();
  const inMemory = file === ':memory:';

  if (!inMemory) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // SQLite wraps JSON1 in recent builds; ensure json_each is available.
  if (!inMemory) db.pragma('busy_timeout = 5000');

  db.exec(SCHEMA_SQL);
  applyUpgrades(db);

  cached = db;

  return db;
}

export function closeDb(): void {
  if (cached) {
    cached.close();
    cached = null;
  }
}

/** Run the schema migrations against a fresh database handle (used by tests). */
export function createTestDb(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}
