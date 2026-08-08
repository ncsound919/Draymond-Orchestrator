#!/usr/bin/env node
// ============================================================================
// Supabase → local SQLite migration
// ============================================================================
// Usage:
//   node scripts/import-from-supabase.mjs dump     # fetch all draymond_* rows
//                                                  # + release files → ./data/
//   node scripts/import-from-supabase.mjs import   # load the dump into SQLite
//   node scripts/import-from-supabase.mjs all      # dump then import
//
// Env (auto-loaded from .env.local):
//   NEXT_PUBLIC_SUPABASE_URL        required for dump
//   SUPABASE_SERVICE_ROLE_KEY       required for dump
//   DRAYMOND_DB_PATH                optional sqlite path (default ./data/draymond.db)
//   DRAYMOND_RELEASES_DIR           optional (default ./data/paid-releases)
//
// The import step introspects the target SQLite schema (created by the app on
// first boot), so no schema copy lives in this script.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

const TABLES = [
  'draymond_agents',
  'draymond_sessions',
  'draymond_events',
  'draymond_actions',
  'draymond_memory',
  'draymond_handoffs',
  'draymond_entities',
  'draymond_chains',
  'draymond_chain_steps',
  'draymond_entity_relations',
  'draymond_goals',
  'draymond_notifications',
  'draymond_scheduled_jobs',
  'draymond_site_monitors',
  'draymond_messages',
  'draymond_execution_logs',
  'draymond_cost_records',
  'draymond_event_subscriptions',
  'draymond_reactive_events',
  'draymond_memory_shares',
  'brain_wiki_pages',
  'draymond_benchmarks',
  'draymond_upgrade_queue',
  'purchases',
];

const PRODUCT_FILES = {
  'sports-steve-bet-buddy': 'SportsSteveAndBetBuddy-Windows-x64.exe',
  'draymond-orchestrator': 'DraymondOrchestrator-Windows-x64.exe',
  'open-chat': 'OpenChat-Windows-x64.exe',
};

const DUMP_PATH = path.join(root, 'data', 'supabase-dump.json');

// ── .env.local loader ────────────────────────────────────────────────────────

function loadDotEnvLocal() {
  const file = path.join(root, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// ── dump ─────────────────────────────────────────────────────────────────────

async function dump() {
  loadDotEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      '[dump] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
    process.exit(1);
  }

  const dump = {};

  for (const table of TABLES) {
    const rows = [];
    let range = 0;
    for (;;) {
      const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Range: `${range}-${range + 999}`,
          Prefer: 'return=representation',
        },
      });
      if (!res.ok) {
        if (res.status === 404) {
          // Table doesn't exist in this Supabase project — treat as empty.
          console.warn(`[dump] ${table}: table not found (0 rows)`);
        } else {
          console.error(`[dump] ${table}: HTTP ${res.status}`);
        }
        break;
      }
      const batch = await res.json();
      rows.push(...batch);
      if (batch.length < 1000) break;
      range += 1000;
    }
    dump[table] = rows;
    console.log(`[dump] ${table}: ${rows.length} rows`);
  }

  fs.mkdirSync(path.dirname(DUMP_PATH), { recursive: true });
  fs.writeFileSync(DUMP_PATH, JSON.stringify(dump, null, 2));
  console.log(`[dump] wrote ${DUMP_PATH}`);

  // Download the paid-release binaries from Storage.
  const releasesDir = process.env.DRAYMOND_RELEASES_DIR ?? path.join(root, 'data', 'paid-releases');
  fs.mkdirSync(releasesDir, { recursive: true });
  for (const [productId, objectKey] of Object.entries(PRODUCT_FILES)) {
    const dest = path.join(releasesDir, objectKey);
    if (fs.existsSync(dest)) {
      console.log(`[dump] release ${objectKey}: already exists, skipping`);
      continue;
    }
    const res = await fetch(`${url}/storage/v1/object/paid-releases/${objectKey}`, {
      headers: { Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) {
      console.warn(`[dump] release ${objectKey}: HTTP ${res.status} (skipping)`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log(`[dump] release ${objectKey}: ${buf.length} bytes`);
  }
}

// ── import ───────────────────────────────────────────────────────────────────

function toStored(value) {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function importDump(dump) {
  const Database = require('better-sqlite3');
  const dbPath =
    process.env.DRAYMOND_DB_PATH ?? path.join(root, 'data', 'draymond.db');
  if (!fs.existsSync(dbPath)) {
    console.error(
      `[import] Database not found at ${dbPath}. Start the app once (npm run dev) so the schema is created, then re-run this command.`
    );
    process.exit(1);
  }
  const db = new Database(dbPath);

  const tables = Object.keys(dump);
  const tx = db.transaction(() => {
    for (const table of tables) {
      const rows = dump[table];
      if (!rows || rows.length === 0) continue;
      const cols = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name);
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols
          .map(() => '?')
          .join(', ')})`
      );
      let inserted = 0;
      for (const row of rows) {
        const values = cols.map((c) => toStored(row[c]));
        stmt.run(...values);
        inserted++;
      }
      console.log(`[import] ${table}: ${inserted} rows`);
    }
  });
  tx();
  db.close();
  console.log(`[import] done → ${dbPath}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

const command = process.argv[2] ?? 'all';

if (command === 'dump' || command === 'all') {
  await dump();
}
if (command === 'import' || command === 'all') {
  loadDotEnvLocal();
  if (!fs.existsSync(DUMP_PATH)) {
    console.error(`[import] No dump found at ${DUMP_PATH}. Run "dump" first.`);
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8'));
  importDump(dump);
}
if (!['dump', 'import', 'all'].includes(command)) {
  console.log('Usage: node scripts/import-from-supabase.mjs [dump|import|all]');
}
