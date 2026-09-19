// ============================================================================
// DRAYMOND AGENT IDE — review gate (honest progress)
// ============================================================================
// After the team finishes its edits the session runs a review gate before it
// can claim "done":
//   • Codegang  — local deep analysis of the changed files (0-100 qualityScore
//                 + findings). Works on local workspaces, no GitHub needed.
//   • RepoRank  — repo-level scan + fix packs when a repo URL is known (primary).
//   • Grader    — independent data-backed grade (fallback when RepoRank is
//                 unavailable or returns no score).
//   • RepoRank /api/scores — the Codegang score is pushed in so the "single
//                 source of truth" for progress stays centralised.
// All scorers fail soft: an offline reviewer must never block the session, it
// just records a note. The gate only fails the session when a scorer actually
// returned a score below the threshold.
// ============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import type { IdeSession, IdeFileChange } from './types';
import { codegangAnalyzeFile, codegangIsUp } from './codegang-client';
import { scoreWithReporank, scoreWithGrader } from '../draymond/deep-scorers';
import { publishSessionEvent } from './event-bus';

const MAX_ANALYZED_FILES = 10;
const DEFAULT_GATE_THRESHOLD = Number(process.env.IDE_REVIEW_THRESHOLD ?? 60);

export interface ReviewGateResult {
  scorer: string;
  score: number | null;
  grade?: string;
  summary: string;
  detail?: string;
  error?: string;
  gateThreshold: number;
  passed: boolean;
}

/** Resolve a changed-file path under the session workspace, verifying the REAL
 *  path (symlinks/junctions resolved) stays inside the workspace. Case-insensitive
 *  on win32. Returns null when the path escapes. */
async function resolveWorkspacePath(session: IdeSession, filePath: string): Promise<string | null> {
  const workspace = session.workspace ?? process.cwd();
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(workspace, filePath);
  try {
    const realRoot = await /*turbopackIgnore: true*/ fs.realpath(workspace);
    const realAbs = await fs.realpath(abs);
    const root = process.platform === 'win32' ? realRoot.toLowerCase() : realRoot;
    const target = process.platform === 'win32' ? realAbs.toLowerCase() : realAbs;
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    return realAbs;
  } catch {
    return null; // unreadable / unresolvable → skip
  }
}

async function readChangedFiles(session: IdeSession): Promise<Array<{ path: string; content: string }>> {
  const changed = new Map<string, IdeFileChange>();
  for (const step of session.steps) {
    for (const f of step.files ?? []) {
      if (!f.path || f.action === 'deleted') continue;
      changed.set(f.path, f);
    }
  }
  const out: Array<{ path: string; content: string }> = [];
  for (const rel of changed.keys()) {
    if (out.length >= MAX_ANALYZED_FILES) break;
    const realAbs = await resolveWorkspacePath(session, rel);
    if (!realAbs) continue;
    try {
      const stat = await /*turbopackIgnore: true*/ fs.stat(realAbs);
      if (!stat.isFile()) continue;
      if (stat.size > 200_000) continue; // skip huge files
      const content = await /*turbopackIgnore: true*/ fs.readFile(realAbs, 'utf-8');
      out.push({ path: rel, content });
    } catch {
      // file not readable — skip
    }
  }
  return out;
}

async function codegangLocalReview(session: IdeSession): Promise<ReviewGateResult> {
  const up = await codegangIsUp();
  if (!up) {
    return { scorer: 'codegang', score: null, summary: 'codegang skipped (offline)', gateThreshold: DEFAULT_GATE_THRESHOLD, passed: true };
  }

  const files = await readChangedFiles(session);
  if (files.length === 0) {
    return { scorer: 'codegang', score: null, summary: 'codegang skipped (no readable changed files)', gateThreshold: DEFAULT_GATE_THRESHOLD, passed: true };
  }

  const scores: number[] = [];
  let totalIssues = 0;
  let critical = 0;
  let high = 0;
  let findingsSnippet = '';

  for (const f of files) {
    const res = await codegangAnalyzeFile({ filePath: f.path, content: f.content });
    if (res.success && typeof res.metrics?.qualityScore === 'number') {
      scores.push(res.metrics.qualityScore);
      totalIssues += res.metrics.totalIssues;
      critical += res.metrics.criticalCount;
      high += res.metrics.highCount;
      const top = (res.findings ?? [])
        .filter((x) => x.severity === 'critical' || x.severity === 'high')
        .slice(0, 3)
        .map((x) => `[${x.severity}] ${x.title ?? 'finding'}${x.file ? ` @ ${x.file}` : ''}`)
        .join('; ');
      if (top) findingsSnippet = findingsSnippet ? `${findingsSnippet} | ${top}` : top;
    }
  }

  if (scores.length === 0) {
    return { scorer: 'codegang', score: null, summary: 'codegang could not score any changed files', gateThreshold: DEFAULT_GATE_THRESHOLD, passed: true };
  }

  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return {
    scorer: 'codegang',
    score: avg,
    summary: `${files.length} file(s) · ${totalIssues} issues · ${critical} critical / ${high} high`,
    detail: findingsSnippet || undefined,
    gateThreshold: DEFAULT_GATE_THRESHOLD,
    passed: avg >= DEFAULT_GATE_THRESHOLD,
  };
}

async function repoScorers(session: IdeSession): Promise<ReviewGateResult | null> {
  if (!session.repoUrl) return null;
  try {
    const reporank = await scoreWithReporank('codegang-ide', session.repoUrl);
    if (typeof reporank.score === 'number') {
      return {
        scorer: 'reporank',
        score: reporank.score,
        grade: /grade ([A-F+])/.exec(reporank.summary)?.[1],
        summary: reporank.summary,
        detail: reporank.detail,
        error: reporank.error,
        gateThreshold: DEFAULT_GATE_THRESHOLD,
        passed: reporank.score >= DEFAULT_GATE_THRESHOLD,
      };
    }
    const grader = await scoreWithGrader('codegang-ide', session.repoUrl);
    if (typeof grader.score === 'number') {
      return {
        scorer: 'grader',
        score: grader.score,
        grade: /grade ([A-F+])/.exec(grader.summary)?.[1],
        summary: grader.summary,
        detail: grader.detail,
        error: grader.error,
        gateThreshold: DEFAULT_GATE_THRESHOLD,
        passed: grader.score >= DEFAULT_GATE_THRESHOLD,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Best-effort push of a local score into RepoRank's /api/scores. Never throws. */
async function pushScoreToReporank(session: IdeSession, result: ReviewGateResult): Promise<boolean> {
  if (!session.repoUrl || !result.score || typeof result.score !== 'number') return false;
  const base = process.env.REPORANK_URL;
  const key = process.env.REPORANK_API_KEY;
  if (!base || !key) return false;
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        repoUrl: session.repoUrl,
        score: result.score,
        gradeCategory: result.grade,
        issues: result.summary,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ReviewGateOutput {
  review: ReviewGateResult;
  pushedToReporank: boolean;
}

/**
 * Run the full review gate for a session. Emits a `review.verdict` event and
 * returns the gating result. Never throws.
 */
export async function runReviewGate(session: IdeSession): Promise<ReviewGateOutput> {
  const local = await codegangLocalReview(session);
  const repo = await repoScorers(session);

  // Gate on the strongest available scorer (repo first, then local).
  const review: ReviewGateResult = repo ?? local;

  let pushedToReporank = false;
  if (local.score !== null && local.scorer === 'codegang') {
    pushedToReporank = await pushScoreToReporank(session, local);
  }

  publishSessionEvent(session.id, {
    id: `${Date.now()}-review`,
    ts: new Date().toISOString(),
    type: 'review.verdict',
    sessionId: session.id,
    data: { review },
  });

  return { review, pushedToReporank };
}
