// ============================================================================
// DRAYMOND DEEP SCORERS — reporank / Grader / Vibe-Reality adapters
// ============================================================================
// Invoked only on the weakest N components each cycle. Every scorer fails soft
// (returns an error string, never throws) so one offline scorer can't kill the
// benchmark loop.
//
// Real contracts (verified against the running services):
//   RepoRank   POST /api/v1/scans  (Bearer gr_ API key)  → { data: { scanId } }
//              GET  /api/v1/scans/:id                    → { data: { status,
//                result: { overallScore, gradeCategory } } }
//              The scan is asynchronous (Bull + Gemini); poll until "complete".
//   Grader     POST /api/grade     (Bearer gr_ API key)  → full HealthReport
//                { overallScore, gradeCategory, summary, ... } (CSRF skipped
//                for Bearer clients).
//   Vibe-Reality POST /api/analyze (idToken)             → { jobId }
//              GET  /api/jobs/:jobId                     → { status, result:
//                { realityScore } }
// ============================================================================

import type { ComponentClass, DeepScoreResult } from './types';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;
const LOCAL_SCORE_TIMEOUT_MS = 180_000;

/** Normalize an entity repoUrl to a GitHub URL RepoRank/Grader accept. */
function normalizeRepoUrl(repoUrl?: string): string | null {
  if (!repoUrl || typeof repoUrl !== 'string') return null;
  const trimmed = repoUrl.trim();
  if (!trimmed) return null;
  // Already a full URL (github.com).
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // "owner/repo" shorthand → expand to a GitHub URL.
  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) return `https://github.com/${trimmed}`;
  // Draymond's `repo:<name>` fallback — not a real repo, nothing to score.
  if (trimmed.startsWith('repo:')) return null;
  return trimmed;
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 15_000
): Promise<{ ok: boolean; json: Json; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, json: null, error: `HTTP ${res.status}` };
    return { ok: true, json: await res.json() };
  } catch (err) {
    return { ok: false, json: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function getJson(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 15_000
): Promise<{ ok: boolean; json: Json; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, json: null, error: `HTTP ${res.status}` };
    return { ok: true, json: await res.json() };
  } catch (err) {
    return { ok: false, json: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function soft(result: Partial<DeepScoreResult> & { scorer: string }): DeepScoreResult {
  return {
    scorer: result.scorer,
    score: result.score ?? null,
    summary: result.summary ?? 'no summary',
    detail: result.detail,
    error: result.error,
  };
}

// ── RepoRank — async scan submit + poll ─────────────────────────────────────

export async function scoreWithReporank(
  slug: string,
  repoUrl?: string
): Promise<DeepScoreResult> {
  const base = process.env.REPORANK_URL;
  if (!base) return soft({ scorer: 'reporank', error: 'REPORANK_URL not set' });

  const repo = normalizeRepoUrl(repoUrl);
  if (!repo) {
    return soft({ scorer: 'reporank', error: 'no GitHub repo URL to score', summary: 'reporank skipped (no repo)' });
  }

  const apiKey = process.env.REPORANK_API_KEY;
  if (!apiKey) return soft({ scorer: 'reporank', error: 'REPORANK_API_KEY not set (create a gr_ key in RepoRank org settings)' });
  const auth = { Authorization: `Bearer ${apiKey}` };

  // 1. Submit the scan.
  const submit = await postJson(
    `${base.replace(/\/+$/, '')}/api/v1/scans`,
    { repoUrl: repo, branch: 'main', buildSource: 'github' },
    auth,
    30_000
  );
  if (!submit.ok) return soft({ scorer: 'reporank', error: `scan submit: ${submit.error}` });
  const scanId = submit.json?.data?.scanId;
  if (!scanId) return soft({ scorer: 'reporank', error: 'scan submit returned no scanId' });

  // 2. Poll until complete / error / timeout.
  const interval = Number(process.env.REPORANK_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);
  const timeout = Number(process.env.REPORANK_POLL_TIMEOUT_MS ?? DEFAULT_POLL_TIMEOUT_MS);
  const deadline = Date.now() + timeout;
  let lastStatus = 'queued';
  while (Date.now() < deadline) {
    await sleep(interval);
    const poll = await getJson(`${base.replace(/\/+$/, '')}/api/v1/scans/${scanId}`, auth, 15_000);
    if (!poll.ok) {
      // Transient poll errors shouldn't fail the scan outright; keep trying.
      lastStatus = `poll ${poll.error}`;
      continue;
    }
    const data = poll.json?.data;
    lastStatus = String(data?.status ?? 'unknown');
    if (lastStatus === 'complete') {
      const score = typeof data?.result?.overallScore === 'number' ? data.result.overallScore : null;
      const grade = typeof data?.result?.gradeCategory === 'string' ? data.result.gradeCategory : null;
      return soft({
        scorer: 'reporank',
        score,
        summary: grade ? `grade ${grade}` : 'reporank scan complete',
        detail: JSON.stringify(data?.result ?? {}).slice(0, 2000),
      });
    }
    if (lastStatus === 'error') {
      return soft({ scorer: 'reporank', error: String(data?.error ?? 'scan failed') });
    }
  }
  return soft({ scorer: 'reporank', error: `scan timed out (last status: ${lastStatus})` });
}

// ── Grader — synchronous /api/grade ─────────────────────────────────────────

export async function scoreWithGrader(
  slug: string,
  repoUrl?: string
): Promise<DeepScoreResult> {
  const base = process.env.GRADER_URL;
  if (!base) return soft({ scorer: 'grader', error: 'GRADER_URL not set' });

  const repo = normalizeRepoUrl(repoUrl);
  if (!repo) {
    return soft({ scorer: 'grader', error: 'no GitHub repo URL to grade', summary: 'grader skipped (no repo)' });
  }

  const apiKey = process.env.GRADER_API_KEY;
  if (!apiKey) return soft({ scorer: 'grader', error: 'GRADER_API_KEY not set (create a gr_ key in Grader)' });
  const auth = { Authorization: `Bearer ${apiKey}` };

  const timeoutMs = Number(process.env.GRADER_TIMEOUT_MS ?? 90_000);
  const res = await postJson(
    `${base.replace(/\/+$/, '')}/api/grade`,
    { repoUrl: repo },
    auth,
    timeoutMs
  );
  if (!res.ok) return soft({ scorer: 'grader', error: res.error });

  const score = typeof res.json?.overallScore === 'number' ? res.json.overallScore : null;
  const grade = typeof res.json?.gradeCategory === 'string' ? res.json.gradeCategory : null;
  return soft({
    scorer: 'grader',
    score,
    summary: grade ? `grade ${grade}` : typeof res.json?.summary === 'string' ? res.json.summary : 'grader scored',
    detail: JSON.stringify(res.json).slice(0, 2000),
  });
}

// ── Vibe-Reality — async /api/analyze + job poll ────────────────────────────

export async function scoreWithVibeReality(slug: string, repoUrl?: string): Promise<DeepScoreResult> {
  const base = process.env.VIBE_REALITY_URL;
  if (!base) return soft({ scorer: 'vibe-reality', error: 'VIBE_REALITY_URL not set' });

  const repo = normalizeRepoUrl(repoUrl);
  if (!repo) {
    return soft({ scorer: 'vibe-reality', error: 'no GitHub repo URL to analyze', summary: 'vibe skipped (no repo)' });
  }

  const idToken = process.env.VIBE_REALITY_ID_TOKEN;
  if (!idToken) return soft({ scorer: 'vibe-reality', error: 'VIBE_REALITY_ID_TOKEN not set (Firebase ID token required by Vibe-Reality)' });

  const submit = await postJson(
    `${base.replace(/\/+$/, '')}/api/analyze`,
    { repoUrl: repo, ephemeral: true, idToken },
    {},
    15_000
  );
  if (!submit.ok) return soft({ scorer: 'vibe-reality', error: `analyze submit: ${submit.error}` });
  const jobId = submit.json?.jobId;
  if (!jobId) return soft({ scorer: 'vibe-reality', error: 'analyze submit returned no jobId' });

  const interval = Number(process.env.VIBE_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);
  const timeout = Number(process.env.VIBE_POLL_TIMEOUT_MS ?? DEFAULT_POLL_TIMEOUT_MS);
  const deadline = Date.now() + timeout;
  let lastStatus = 'pending';
  while (Date.now() < deadline) {
    await sleep(interval);
    const poll = await getJson(`${base.replace(/\/+$/, '')}/api/jobs/${jobId}`, {}, 15_000);
    if (!poll.ok) {
      lastStatus = `poll ${poll.error}`;
      continue;
    }
    lastStatus = String(poll.json?.status ?? 'unknown');
    if (lastStatus === 'complete') {
      const score = typeof poll.json?.result?.realityScore === 'number' ? poll.json.result.realityScore : null;
      return soft({
        scorer: 'vibe-reality',
        score,
        summary: typeof poll.json?.result?.vibeCheck === 'string' ? poll.json.result.vibeCheck.slice(0, 200) : 'vibe review scored',
        detail: JSON.stringify(poll.json?.result ?? {}).slice(0, 2000),
      });
    }
    if (lastStatus === 'error') {
      return soft({ scorer: 'vibe-reality', error: 'analysis failed' });
    }
  }
  return soft({ scorer: 'vibe-reality', error: `analysis timed out (last status: ${lastStatus})` });
}

/** Run all three scorers for a component. Never throws. */
export async function deepScore(
  componentClass: ComponentClass,
  slug: string,
  name: string,
  repoUrl?: string
): Promise<Record<string, DeepScoreResult>> {
  const repo = normalizeRepoUrl(repoUrl) ?? `repo:${name}`;
  const [a, b, c] = await Promise.all([
    // Prefer the local engines (they run on the shared OpenCode key with no
    // server), falling back to the HTTP APIs when a URL is configured.
    process.env.REPORANK_URL ? scoreWithReporank(slug, repo) : scoreWithLocalReporank(slug, repo),
    process.env.GRADER_URL ? scoreWithGrader(slug, repo) : scoreWithLocalGrader(slug, repo),
    scoreWithVibeReality(slug, repo),
  ]);
  return { reporank: a, grader: b, 'vibe-reality': c };
}

// ── Local engine scorers (tsx subprocess, OpenCode key) ─────────────────────

interface LocalScore {
  overallScore?: number;
  gradeCategory?: string;
  summary?: string;
}

/**
 * Run a local engine wrapper script (scripts/local-grader.ts /
 * scripts/local-reporank.ts) against a GitHub repo and parse its JSON output.
 * Fails soft.
 */
async function runLocalScorer(
  scriptFile: string,
  repoUrl: string
): Promise<{ score: number | null; grade?: string; summary?: string; error?: string }> {
  const repo = normalizeRepoUrl(repoUrl);
  if (!repo) return { score: null, error: 'no GitHub repo URL to score' };

  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const script = path.join(process.cwd(), 'scripts', scriptFile);
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [tsxCli, script, repo],
      {
        timeout: LOCAL_SCORE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env },
      }
    );
    const parsed = JSON.parse(stdout.trim()) as LocalScore;
    return {
      score: typeof parsed.overallScore === 'number' ? parsed.overallScore : null,
      grade: parsed.gradeCategory,
      summary: parsed.summary,
    };
  } catch (err) {
    return { score: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function scoreWithLocalReporank(
  slug: string,
  repoUrl?: string
): Promise<DeepScoreResult> {
  const repo = normalizeRepoUrl(repoUrl);
  if (!repo) {
    return soft({ scorer: 'reporank', error: 'no GitHub repo URL to score', summary: 'reporank skipped (no repo)' });
  }
  const r = await runLocalScorer('local-reporank.ts', repo);
  if (r.score == null) {
    return soft({ scorer: 'reporank', error: r.error ?? 'local reporank failed' });
  }
  return soft({
    scorer: 'reporank',
    score: r.score,
    summary: r.grade ? `grade ${r.grade}` : r.summary ?? 'reporank scored',
  });
}

export async function scoreWithLocalGrader(
  slug: string,
  repoUrl?: string
): Promise<DeepScoreResult> {
  const repo = normalizeRepoUrl(repoUrl);
  if (!repo) {
    return soft({ scorer: 'grader', error: 'no GitHub repo URL to score', summary: 'grader skipped (no repo)' });
  }
  const r = await runLocalScorer('local-grader.ts', repo);
  if (r.score == null) {
    return soft({ scorer: 'grader', error: r.error ?? 'local grader failed' });
  }
  return soft({
    scorer: 'grader',
    score: r.score,
    summary: r.grade ? `grade ${r.grade}` : r.summary ?? 'grader scored',
  });
}
