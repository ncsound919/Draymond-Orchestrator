// ============================================================================
// vault-seed.mjs — POST /api/seed (and verify) using Keywire vault credentials.
// ============================================================================
// The seed endpoint needs `Authorization: Bearer <CRON_SECRET>`. This script
// resolves CRON_SECRET from the Keywire vault at RUNTIME (same exchange +
// export flow as src/lib/draymond/keywire.ts) so the secret never appears in
// shell history, files, or logs — only HTTP statuses and job names are printed.
//
// Reads ONLY non-secret config from Draymond-Orchestrator/.env.local:
//   KEYWIRE_URL, KEYWIRE_PROJECT_ID, KEYWIRE_ENV_SLUG, KEYWIRE_SERVICE_TOKEN
//   DRAYMOND_SEED_URL (optional, default http://localhost:3444)
//
// Usage: node scripts/vault-seed.mjs [--dry] [--url http://localhost:3444]
//   --dry  resolve credentials + GET job list only (no seed write)
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, fb) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : fb;
};

const DRY = flag('--dry');
const local = parseEnvFile(path.join(root, '.env.local'));
const BASE = opt('--url', local.DRAYMOND_SEED_URL || process.env.DRAYMOND_SEED_URL || 'http://localhost:3444');
const PROJECT = local.KEYWIRE_PROJECT_ID || 'prj-mt7jrul1';
const ENV_SLUG = local.KEYWIRE_ENV_SLUG || 'production';
const VAULT = local.KEYWIRE_URL || 'http://localhost:3000';
const TOKEN = local.KEYWIRE_SERVICE_TOKEN || '';

async function vaultExport() {
  if (!TOKEN) throw new Error('KEYWIRE_SERVICE_TOKEN missing from .env.local');
  const ex = await fetch(`${VAULT}/api/v1/auth/service-token/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: TOKEN }),
    signal: AbortSignal.timeout(8000),
  });
  if (!ex.ok) throw new Error(`token exchange failed: HTTP ${ex.status}`);
  const { accessToken } = await ex.json();
  if (!accessToken) throw new Error('token exchange returned no accessToken');
  const res = await fetch(`${VAULT}/api/v1/projects/${PROJECT}/envs/${ENV_SLUG}/export?format=env`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`vault export failed: HTTP ${res.status}`);
  const map = {};
  for (const line of (await res.text()).split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

async function main() {
  let secrets = {};
  try {
    secrets = await vaultExport();
    console.log('[vault-seed] vault export ok (vault-first)');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[vault-seed] vault unusable (${msg}) — degrading to .env.local`);
  }
  const cron = secrets.CRON_SECRET || local.CRON_SECRET || '';
  if (!cron) throw new Error('CRON_SECRET found in neither vault nor .env.local');
  console.log('[vault-seed] credentials resolved (vault-first); calling', BASE);

  if (DRY) {
    const jobs = await fetch(`${BASE}/api/jobs`, {
      headers: { Authorization: `Bearer ${cron}` },
      signal: AbortSignal.timeout(15000),
    });
    console.log('[vault-seed] GET /api/jobs ->', jobs.status);
    if (jobs.ok) {
      const body = await jobs.json().catch(() => ({}));
      const list = body.jobs ?? body.data ?? [];
      for (const j of list) console.log(`  - ${j.name}: enabled=${j.is_enabled} last=${j.last_run_status ?? 'never'}`);
    }
    return;
  }

  const seed = await fetch(`${BASE}/api/seed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cron}`, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(120000),
  });
  console.log('[vault-seed] POST /api/seed ->', seed.status);
  if (!seed.ok) {
    console.log(await seed.text().then((t) => t.slice(0, 500)).catch(() => ''));
    process.exitCode = 1;
    return;
  }
  const body = await seed.json().catch(() => ({}));
  const sched = body.schedule ?? {};
  console.log('[vault-seed] retuned:', JSON.stringify(sched.retuned ?? []));
  console.log('[vault-seed] unchanged:', sched.unchanged ?? '?');
  console.log('[vault-seed] drift:', JSON.stringify(sched.drift ?? []));
  if (body.errors) console.log('[vault-seed] errors:', JSON.stringify(body.errors).slice(0, 500));
}

main().catch((e) => {
  console.error('[vault-seed] FAILED:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
