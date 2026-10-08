/**
 * security-jobs — the scheduled security spine for Draymond.
 *
 * Three custom job handlers, all self-contained (Draymond is always-on, so
 * these cannot depend on an on-demand service being up):
 *   runSecretScanJob()   secret values in the ecosystem working tree (local fs)
 *   verifyBackupsJob()   newest fleet-backup snapshot integrity
 *   checkCiStatusJob()   latest GitHub Actions conclusion for watched repos
 *
 * Every producer emits the same AlertEnvelope (see
 * plans/2026-09-28-security-spine-INTERFACES.md §1) to an append-only
 * `.draymond/security-alerts.jsonl`, plus best-effort email + ntfy (medium+
 * severities only — `info` is logged, never pushed).
 *
 * Honest degradation: missing tokens / drives are reported, never fabricated.
 * These handlers do not throw for environmental conditions (a missing backup
 * drive is not repairable by config) — they return a summary and alert.
 *
 * Keywire (always-on) owns the canonical scheduled secret scan (interfaces §6);
 * this local scan is the Draymond-side check and needs no external service.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { writeBrainFile } from './journal';
import { sendAlertEmail } from './notifications';
import { publishIssueNotification } from './ntfy';

const BRAIN_DIR =
  process.env.DRAYMOND_BRAIN_DIR ||
  process.env.DRAYMOND_REGISTRY_DIR ||
  path.join(process.cwd(), '.draymond');
const ALERTS_FILE = path.join(BRAIN_DIR, 'security-alerts.jsonl');
const UPLIFT_ROOT = process.env.UPLIFT_ROOT || 'C:/Users/User/Downloads/Uplift';
const BACKUP_DIR = process.env.DRAYMOND_BACKUP_DIR || 'E:\\UpliftBackups';

export type AlertSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface AlertEnvelope {
  source: 'keywire' | 'draymond' | 'agentbrowser' | 'backup' | 'ci';
  kind: string;
  severity: AlertSeverity;
  detail: string;
  dedupKey: string;
  meta?: Record<string, unknown>;
  ts: string;
}

function newAlert(input: Omit<AlertEnvelope, 'ts'>): AlertEnvelope {
  return { ...input, ts: new Date().toISOString() };
}

/**
 * Append an alert to the brain log (append-only, last 200 retained) and fan out
 * to email + ntfy for medium+ severities. `info` is recorded only — it must not
 * page the operator. Never throws.
 */
export async function emitSecurityAlert(alert: AlertEnvelope): Promise<void> {
  try {
    let prior = '';
    try {
      prior = fs.readFileSync(ALERTS_FILE, 'utf-8');
    } catch {
      prior = '';
    }
    const lines = prior.split('\n').filter(Boolean).slice(-200);
    lines.push(JSON.stringify(alert));
    writeBrainFile(ALERTS_FILE, `${lines.join('\n')}\n`, 'append', 'security-jobs');
  } catch (err) {
    console.error('[security-jobs] failed to append alert:', err instanceof Error ? err.message : err);
  }

  if (alert.severity === 'info' || alert.severity === 'low') return;

  const title = `[${alert.severity.toUpperCase()}] ${alert.kind}`;
  const body = `${alert.detail}\n\nsource: ${alert.source}\nkey: ${alert.dedupKey}\nat: ${alert.ts}`;
  const recipient = process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER;
  if (recipient) {
    try {
      await sendAlertEmail(recipient, title, body, 'custom', {
        priority: alert.severity === 'critical' ? 'critical' : alert.severity === 'high' ? 'high' : 'normal',
        metadata: { ...alert.meta, source: alert.source, dedupKey: alert.dedupKey },
      });
    } catch (err) {
      console.warn('[security-jobs] email alert failed:', err instanceof Error ? err.message : err);
    }
  }
  try {
    await publishIssueNotification({
      title,
      message: alert.detail,
      priority: alert.severity === 'critical' ? 5 : alert.severity === 'high' ? 4 : 3,
      tags: ['shield'],
    });
  } catch {
    // best-effort
  }
}

// ── Local secret scan (no external service) ─────────────────────────────────
// High-signal value patterns only. Kept in sync with AgentBrowser's
// src/lib/repo-audit.ts (the on-demand deep scanner); both are frozen by the
// interfaces contract.

interface SecretRule {
  ruleId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  pattern: RegExp;
}

const SECRET_RULES: SecretRule[] = [
  { ruleId: 'private-key-block', severity: 'critical', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { ruleId: 'aws-access-key-id', severity: 'critical', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { ruleId: 'github-token', severity: 'critical', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { ruleId: 'google-api-key', severity: 'critical', pattern: /\bAIza[0-9A-Za-z_\-]{35}\b/ },
  { ruleId: 'slack-token', severity: 'high', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { ruleId: 'stripe-live-key', severity: 'critical', pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/ },
  { ruleId: 'stripe-test-key', severity: 'low', pattern: /\b(?:sk|rk)_test_[0-9A-Za-z]{16,}\b/ },
  { ruleId: 'openai-key', severity: 'high', pattern: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { ruleId: 'sendgrid-key', severity: 'high', pattern: /\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b/ },
  { ruleId: 'jwt', severity: 'medium', pattern: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/ },
];

const SCAN_SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'coverage-base',
  '.turbo', '.cache', 'vendor', '__pycache__', '.venv', 'venv', 'out', '.qdrant_data',
  '08_Archive', '_quarantine', 'potential', 'Claude outputs',
]);
const SCAN_TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc', '.yml', '.yaml',
  '.toml', '.ini', '.cfg', '.conf', '.txt', '.md', '.py', '.rb', '.go', '.rs', '.java',
  '.sh', '.ps1', '.psm1', '.sql', '.properties', '.xml', '.html', '.css',
]);

// Sanctioned secret stores are skipped: `.env`/`.env.*`/`*.env` files are
// gitignored and exist to hold secrets — flagging them is noise, not signal.
function isEnvFile(name: string): boolean {
  return name === '.env' || name.startsWith('.env.') || path.extname(name).toLowerCase() === '.env';
}
const MAX_SCAN_FILE_BYTES = 1_000_000;

function isPlaceholder(value: string): boolean {
  const v = value.toLowerCase();
  return (
    v.includes('example') || v.includes('your_') || v.includes('your-') ||
    v.includes('changeme') || v.includes('placeholder') || v.includes('xxxx') ||
    v.includes('redacted') || v.includes('${') || v.includes('<')
  );
}

interface LocalScanResult {
  counts: { critical: number; high: number; medium: number; low: number; total: number };
  topFiles: string[];
  truncated: boolean;
}

/**
 * Walk the ecosystem working tree and scan text files for secret VALUES.
 * Reports rule/file/line only — never the matched text. Bounded by file cap
 * and file size so it cannot wedge the scheduler.
 */
export async function secretScanLocal(
  root: string,
  maxFiles = 20_000,
  deadlineMs = 180_000,
): Promise<LocalScanResult> {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  const filesWithFindings = new Set<string>();
  const start = Date.now();
  let scanned = 0;
  let truncated = false;

  const walk = async (dir: string): Promise<void> => {
    if (truncated) return;
    // Wall-clock budget so a huge tree cannot wedge the scheduler tick.
    if (Date.now() - start > deadlineMs) { truncated = true; return; }
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SCAN_SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isEnvFile(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SCAN_TEXT_EXT.has(ext)) continue;
      if (entry.name.endsWith('.example')) continue;
      if (scanned >= maxFiles) { truncated = true; return; }
      scanned += 1;
      let content: string;
      try {
        const stat = await fsp.stat(full);
        if (stat.size > MAX_SCAN_FILE_BYTES) continue;
        content = await fsp.readFile(full, 'utf8');
      } catch {
        continue;
      }
      if (content.includes('\u0000')) continue; // binary
      const rel = path.relative(root, full).replace(/\\/g, '/');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > 4000) continue;
        for (const rule of SECRET_RULES) {
          const m = rule.pattern.exec(line);
          if (m && !isPlaceholder(m[0])) {
            counts[rule.severity] += 1;
            counts.total += 1;
            filesWithFindings.add(rel);
          }
        }
      }
    }
  };

  await walk(root);
  return { counts, topFiles: Array.from(filesWithFindings).slice(0, 10), truncated };
}

export interface SecretScanSummary {
  ok: boolean;
  status: string;
  counts: { critical: number; high: number; medium: number; low: number; total: number };
  truncated: boolean;
  topFiles: string[];
}

/** Scan the ecosystem working tree for secret values. Alerts on critical/high. */
export async function runSecretScanJob(): Promise<SecretScanSummary> {
  const maxFiles = Number(process.env.DRAYMOND_SECRET_SCAN_MAX_FILES || 20_000);
  const deadlineMs = Number(process.env.DRAYMOND_SECRET_SCAN_DEADLINE_MS || 180_000);
  const { counts, topFiles, truncated } = await secretScanLocal(UPLIFT_ROOT, maxFiles, deadlineMs);
  const summary: SecretScanSummary = {
    ok: counts.total === 0,
    status: counts.total === 0 ? 'clean' : 'findings',
    counts,
    truncated,
    topFiles,
  };

  if (counts.critical > 0 || counts.high > 0) {
    const detail = `secret scan found ${counts.critical} critical / ${counts.high} high across ${topFiles.length}+ file(s): ${topFiles.slice(0, 5).join(', ')}`;
    await emitSecurityAlert(newAlert({
      source: 'draymond', kind: 'secret-scan',
      severity: counts.critical > 0 ? 'critical' : 'high',
      detail,
      dedupKey: `secret-scan:${counts.critical}:${counts.high}`,
      meta: { counts, topFiles },
    }));
  } else if (truncated) {
    await emitSecurityAlert(newAlert({
      source: 'draymond', kind: 'secret-scan', severity: 'low',
      detail: 'secret scan hit the file cap and did not finish (raise DRAYMOND_SECRET_SCAN_MAX_FILES)',
      dedupKey: 'secret-scan:truncated',
    }));
  }
  return summary;
}

// ── Backup verification ─────────────────────────────────────────────────────

export interface BackupVerifySummary {
  ok: boolean;
  dir: string;
  latestStamp: string | null;
  ageHours: number | null;
  manifestOk: boolean | null;
  failCount: number;
  errors: string[];
}

function parseStamp(stamp: string): number | null {
  const m = stamp.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:00`);
  return Number.isNaN(t) ? null : t;
}

/** Verify the newest fleet-backup snapshot. Reads the snapshot's manifest.json
 *  (interfaces §5) when present, else falls back to scanning backup-log.txt. */
export async function verifyBackupsJob(notify = true): Promise<BackupVerifySummary> {
  const maxAgeHours = Number(process.env.DRAYMOND_BACKUP_MAX_AGE_HOURS ?? 30);
  const summary: BackupVerifySummary = {
    ok: false, dir: BACKUP_DIR, latestStamp: null, ageHours: null,
    manifestOk: null, failCount: 0, errors: [],
  };

  if (!fs.existsSync(BACKUP_DIR)) {
    summary.errors.push('backup directory missing');
    if (notify) await emitSecurityAlert(newAlert({
      source: 'backup', kind: 'backup-verify', severity: 'high',
      detail: `backup directory does not exist: ${BACKUP_DIR} (is the drive mounted?)`,
      dedupKey: `backup:missing:${BACKUP_DIR}`, meta: { dir: BACKUP_DIR },
    }));
    return summary;
  }

  const stamps = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'escrow' && parseStamp(d.name) !== null)
    .map((d) => d.name)
    .sort()
    .reverse();

  if (stamps.length === 0) {
    summary.errors.push('no snapshots found');
    if (notify) await emitSecurityAlert(newAlert({
      source: 'backup', kind: 'backup-verify', severity: 'high',
      detail: `no backup snapshots under ${BACKUP_DIR}`,
      dedupKey: 'backup:none', meta: { dir: BACKUP_DIR },
    }));
    return summary;
  }

  const latest = stamps[0];
  summary.latestStamp = latest;
  const t = parseStamp(latest);
  summary.ageHours = t === null ? null : (Date.now() - t) / 3_600_000;
  const snapDir = path.join(BACKUP_DIR, latest);

  const manifestPath = path.join(snapDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        ok?: boolean; encrypted?: boolean; counts?: { fail?: number }; errors?: string[];
      };
      summary.manifestOk = manifest.ok ?? null;
      summary.failCount = manifest.counts?.fail ?? 0;
      if (manifest.encrypted === false) summary.errors.push('escrow not encrypted');
      if (manifest.errors?.length) summary.errors.push(...manifest.errors.slice(0, 5));
    } catch (err) {
      summary.errors.push(`manifest unreadable: ${err instanceof Error ? err.message : 'parse error'}`);
    }
  } else {
    const logPath = path.join(snapDir, 'backup-log.txt');
    if (fs.existsSync(logPath)) {
      const log = fs.readFileSync(logPath, 'utf-8');
      summary.failCount = (log.match(/^FAIL/gm) ?? []).length;
      summary.manifestOk = summary.failCount === 0;
    } else {
      summary.errors.push('no manifest.json or backup-log.txt in latest snapshot');
    }
  }

  const stale = summary.ageHours !== null && summary.ageHours > maxAgeHours;
  summary.ok = summary.manifestOk !== false && summary.failCount === 0 && !stale && summary.errors.length === 0;

  if (!summary.ok) {
    const detail = [
      `latest backup ${latest} (${summary.ageHours === null ? 'unknown age' : `${summary.ageHours.toFixed(1)}h old`})`,
      stale ? `stale > ${maxAgeHours}h` : null,
      summary.failCount > 0 ? `${summary.failCount} FAIL item(s)` : null,
      summary.errors.length ? summary.errors.join('; ') : null,
    ].filter(Boolean).join(' — ');
    if (notify) await emitSecurityAlert(newAlert({
      source: 'backup', kind: 'backup-verify',
      severity: summary.manifestOk === false || stale ? 'high' : 'medium',
      detail, dedupKey: `backup:${latest}:${summary.ok}`, meta: { ...summary },
    }));
  }
  return summary;
}

// ── CI status (direct GitHub API — no on-demand service) ────────────────────

export interface CiStatusSummary {
  ok: boolean;
  repos: Array<{ repo: string; conclusion: string | null; status: string; runUrl: string | null; reason?: string }>;
}

const SAFE_SLUG = /^[\w][\w.\-]{0,99}$/;

async function githubActionsStatus(
  owner: string,
  repo: string,
  ref: { sha?: string; branch?: string },
): Promise<{ conclusion: string | null; status: string; runUrl: string | null; reason?: string }> {
  if (!SAFE_SLUG.test(owner) || !SAFE_SLUG.test(repo)) {
    return { conclusion: null, status: 'error', runUrl: null, reason: 'invalid owner/repo' };
  }
  const token = process.env.GITHUB_TOKEN || '';
  if (!token) return { conclusion: null, status: 'unavailable', runUrl: null, reason: 'github_token_missing' };
  const params = new URLSearchParams({ per_page: '1' });
  if (ref.sha) params.set('head_sha', ref.sha);
  else if (ref.branch) params.set('branch', ref.branch);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Draymond/1.0' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return { conclusion: null, status: 'error', runUrl: null, reason: `github_http_${res.status}` };
    const data = (await res.json()) as { workflow_runs?: Array<{ conclusion: string | null; status: string; html_url: string }> };
    const run = data.workflow_runs?.[0];
    if (!run) return { conclusion: null, status: 'none', runUrl: null, reason: 'no_runs' };
    return { conclusion: run.conclusion, status: run.status, runUrl: run.html_url };
  } catch {
    return { conclusion: null, status: 'unavailable', runUrl: null, reason: 'github_unreachable' };
  }
}

/** Poll the latest GitHub Actions run for each repo in DRAYMOND_CI_REPOS
 *  (comma list of `owner/repo` or `owner/repo#branch`). Alerts on non-success. */
export async function checkCiStatusJob(): Promise<CiStatusSummary> {
  const raw = process.env.DRAYMOND_CI_REPOS || '';
  const entries = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const summary: CiStatusSummary = { ok: true, repos: [] };

  if (entries.length === 0) {
    await emitSecurityAlert(newAlert({
      source: 'ci', kind: 'ci-status', severity: 'info',
      detail: 'CI watch list empty — set DRAYMOND_CI_REPOS=owner/repo[,owner/repo#branch]',
      dedupKey: 'ci:unconfigured',
    }));
    return summary;
  }

  for (const entry of entries) {
    const [repoPart, branch] = entry.split('#');
    const [owner, repo] = repoPart.split('/');
    if (!owner || !repo) {
      summary.repos.push({ repo: entry, conclusion: null, status: 'error', runUrl: null, reason: 'bad entry' });
      summary.ok = false;
      continue;
    }
    const ci = await githubActionsStatus(owner, repo, { branch });
    summary.repos.push({ repo: entry, ...ci });
    if (ci.status === 'unavailable' || ci.status === 'error') { summary.ok = false; continue; }
    if (ci.conclusion && ci.conclusion !== 'success') {
      summary.ok = false;
      await emitSecurityAlert(newAlert({
        source: 'ci', kind: 'ci-status', severity: 'high',
        detail: `${entry} latest run: ${ci.conclusion}${ci.runUrl ? ` (${ci.runUrl})` : ''}`,
        dedupKey: `ci:${entry}:${ci.runUrl ?? ci.conclusion}`,
        meta: { repo: entry, ...ci },
      }));
    }
  }
  return summary;
}
