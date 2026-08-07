// ============================================================================
// DRAYMOND DEEP SCORERS — reporank / Grader / Vibe-Reality adapters
// ============================================================================
// Invoked only on the weakest N components each cycle. Every scorer fails soft
// (returns an error string, never throws) so one offline scorer can't kill the
// benchmark loop. URLs come from env; absent URLs are skipped with an error.
// ============================================================================

import type { ComponentClass, DeepScoreResult } from './types';

const TIMEOUT_MS = 15_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function postJson(url: string, body: unknown): Promise<{ ok: boolean; json: any; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, json: null, error: `HTTP ${res.status}` };
    return { ok: true, json: await res.json() };
  } catch (err) {
    return { ok: false, json: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function soft(result: Partial<DeepScoreResult> & { scorer: string }): DeepScoreResult {
  return {
    scorer: result.scorer,
    score: result.score ?? null,
    summary: result.summary ?? 'no summary',
    detail: result.detail,
    error: result.error,
  };
}

/** reporank — POST /api/v1/trust (or /api/v1/scans). */
export async function scoreWithReporank(
  slug: string,
  repoUrl?: string
): Promise<DeepScoreResult> {
  const base = process.env.REPORANK_URL;
  if (!base) return soft({ scorer: 'reporank', error: 'REPORANK_URL not set' });
  const res = await postJson(`${base.replace(/\/+$/, '')}/api/v1/trust`, {
    repo_url: repoUrl ?? slug,
    project: slug,
  });
  if (!res.ok) return soft({ scorer: 'reporank', error: res.error });
  const score = typeof res.json?.trust === 'number' ? res.json.trust : null;
  return soft({
    scorer: 'reporank',
    score,
    summary: typeof res.json?.summary === 'string' ? res.json.summary : 'reporank trust scored',
    detail: JSON.stringify(res.json).slice(0, 2000),
  });
}

/** Grader — repo quality/valuation. */
export async function scoreWithGrader(
  slug: string,
  repoUrl?: string
): Promise<DeepScoreResult> {
  const base = process.env.GRADER_URL;
  if (!base) return soft({ scorer: 'grader', error: 'GRADER_URL not set' });
  const res = await postJson(`${base.replace(/\/+$/, '')}/api/grade`, {
    repo_url: repoUrl ?? slug,
    project: slug,
  });
  if (!res.ok) return soft({ scorer: 'grader', error: res.error });
  const score = typeof res.json?.score === 'number' ? res.json.score : null;
  return soft({
    scorer: 'grader',
    score,
    summary: typeof res.json?.grade === 'string' ? `grade ${res.json.grade}` : 'grader scored',
    detail: JSON.stringify(res.json).slice(0, 2000),
  });
}

/** Vibe-Reality — UX / app review. */
export async function scoreWithVibeReality(slug: string): Promise<DeepScoreResult> {
  const base = process.env.VIBE_REALITY_URL;
  if (!base) return soft({ scorer: 'vibe-reality', error: 'VIBE_REALITY_URL not set' });
  const res = await postJson(`${base.replace(/\/+$/, '')}/api/review`, {
    app: slug,
  });
  if (!res.ok) return soft({ scorer: 'vibe-reality', error: res.error });
  const score = typeof res.json?.vibeScore === 'number' ? res.json.vibeScore : null;
  return soft({
    scorer: 'vibe-reality',
    score,
    summary: typeof res.json?.feedback === 'string' ? res.json.feedback : 'vibe review scored',
    detail: JSON.stringify(res.json).slice(0, 2000),
  });
}

/** Run all three scorers for a component. Never throws. */
export async function deepScore(
  componentClass: ComponentClass,
  slug: string,
  name: string,
  repoUrl?: string
): Promise<Record<string, DeepScoreResult>> {
  const repo = repoUrl ?? `repo:${name}`;
  const [a, b, c] = await Promise.all([
    scoreWithReporank(slug, repo),
    scoreWithGrader(slug, repo),
    scoreWithVibeReality(slug),
  ]);
  return { reporank: a, grader: b, 'vibe-reality': c };
}
