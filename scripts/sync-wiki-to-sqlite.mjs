#!/usr/bin/env node
/**
 * Sync the deterministic-brain wiki (Markdown) into the local SQLite
 * brain_wiki_pages table.
 *
 * Usage:
 *   node scripts/sync-wiki-to-sqlite.mjs [--wiki-dir <path>] [--dry-run]
 *
 * Requires: the app has been started once so data/draymond.db exists
 * (DRAYMOND_DB_PATH overrides the location). Idempotent — upserts by slug,
 * deletes pages whose source file is gone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const defaultWikiDir = path.join(
  root,
  'agents',
  'VibeServe-main',
  'ide',
  'packages',
  'deterministic-brain',
  'wiki'
);
const wikiDir = process.argv.includes('--wiki-dir')
  ? process.argv[process.argv.indexOf('--wiki-dir') + 1]
  : defaultWikiDir;
const dryRun = process.argv.includes('--dry-run');

const dbPath = process.env.DRAYMOND_DB_PATH ?? path.join(root, 'data', 'draymond.db');

function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { fm: {}, body: text };
  const data = {};
  let key = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    if (/^\s/.test(line)) {
      if (key) {
        const item = line.trim().replace(/^-\s*/, '');
        if (item && !Array.isArray(data[key])) data[key] = [];
        if (/:/.test(item) && !item.startsWith('-')) {
          const [k, ...rest] = item.split(':');
          data[key].push({ [k.trim()]: rest.join(':').trim() });
        } else if (item) {
          data[key].push(item);
        }
      }
      continue;
    }
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if (!k) continue;
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (v === 'true' || v === 'false') {
      v = v === 'true';
    } else if (v === '') {
      key = k; data[k] = [];
      continue;
    } else if (/^\d+$/.test(v)) {
      v = Number(v);
    }
    data[k] = v;
    key = k;
  }
  return { fm: data, body: m.input.slice(m[0].length).trim() };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) out.push(full);
  }
  return out;
}

function toStored(value) {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function main() {
  if (!fs.existsSync(dbPath)) {
    console.error(
      `[sync] Database not found at ${dbPath}. Start the app once (npm run dev) so the schema is created, then re-run.`
    );
    process.exit(1);
  }
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);

  const files = walk(wikiDir);
  let added = 0, updated = 0, removed = 0;

  const existing = new Set(
    db.prepare('SELECT slug FROM brain_wiki_pages').all().map((r) => r.slug)
  );

  const upsert = db.prepare(
    `INSERT INTO brain_wiki_pages (id, slug, namespace, title, content, tags, sources, aliases, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET
       namespace = excluded.namespace,
       title = excluded.title,
       content = excluded.content,
       tags = excluded.tags,
       sources = excluded.sources,
       aliases = excluded.aliases,
       updated_at = excluded.updated_at`
  );

  for (const file of files) {
    const rel = path.relative(wikiDir, file).replace(/\\/g, '/');
    const slug = rel.replace(/\.md$/, '');
    const text = fs.readFileSync(file, 'utf8');
    const { fm, body } = parseFrontmatter(text);
    const title = fm.title || path.basename(slug).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const namespace = fm.namespace || slug.split('/')[0];
    const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
    const aliases = Array.isArray(fm.aliases) ? fm.aliases.map(String) : [];
    const sources = Array.isArray(fm.sources) ? fm.sources : [];

    if (dryRun) {
      if (existing.has(slug)) updated++; else added++;
      console.log(`[sync] (dry-run) would upsert ${slug}`);
      continue;
    }
    const now = new Date().toISOString();
    const id = existing.has(slug)
      ? db.prepare('SELECT id FROM brain_wiki_pages WHERE slug = ?').get(slug).id
      : require('node:crypto').randomUUID();
    upsert.run(
      id, slug, namespace, title, body,
      toStored(tags), toStored(sources), toStored(aliases), now, now
    );
    if (existing.has(slug)) updated++; else added++;
  }

  // Remove pages whose source file is gone.
  const known = new Set(files.map((f) => path.relative(wikiDir, f).replace(/\\/g, '/').replace(/\.md$/, '')));
  const stale = [...existing].filter((s) => !known.has(s));
  const del = db.prepare('DELETE FROM brain_wiki_pages WHERE slug = ?');
  for (const slug of stale) {
    if (dryRun) { console.log(`[sync] would remove ${slug}`); removed++; continue; }
    del.run(slug);
    removed++;
  }

  db.close();

  if (dryRun) {
    console.log(`[sync] done: +${added} would add, ~${updated} would update, -${removed} would remove (${files.length} files)`);
    console.log('[sync] DRY RUN — no writes performed');
  } else {
    console.log(`[sync] done: +${added} added, ~${updated} updated, -${removed} removed (${files.length} files)`);
  }
}

main();
