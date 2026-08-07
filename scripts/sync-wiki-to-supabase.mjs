#!/usr/bin/env node
/**
 * Sync the deterministic-brain wiki (Markdown) into Supabase brain_wiki_pages.
 *
 * Usage:
 *   node scripts/sync-wiki-to-supabase.mjs [--wiki-dir <path>] [--dry-run]
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
 * Idempotent — upserts by slug, deletes pages whose source file is gone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function main() {
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const files = walk(wikiDir);
  let added = 0, updated = 0, removed = 0;

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

    const row = { slug, namespace, title, content: body, tags, sources, aliases };
    const { data, error } = await supabase
      .from('brain_wiki_pages')
      .upsert(row, { onConflict: 'slug', ignoreDuplicates: false })
      .select('created_at, updated_at')
      .single();
    if (error) {
      console.error(`[sync] FAIL ${slug}: ${error.message}`);
      continue;
    }
    if (data.created_at === data.updated_at) added++; else updated++;
  }

  // Remove pages whose source file is gone.
  const { data: existing } = await supabase.from('brain_wiki_pages').select('slug');
  const known = new Set(files.map((f) => path.relative(wikiDir, f).replace(/\\/g, '/').replace(/\.md$/, '')));
  const stale = (existing || []).map((r) => r.slug).filter((s) => !known.has(s));
  for (const slug of stale) {
    if (dryRun) { console.log(`[sync] would remove ${slug}`); continue; }
    const { error } = await supabase.from('brain_wiki_pages').delete().eq('slug', slug);
    if (error) console.error(`[sync] FAIL remove ${slug}: ${error.message}`);
    else removed++;
  }

  console.log(`[sync] done: +${added} added, ~${updated} updated, -${removed} removed (${files.length} files)`);
  if (dryRun) console.log('[sync] DRY RUN — no writes performed');
}

main().catch((err) => { console.error(err); process.exit(1); });
