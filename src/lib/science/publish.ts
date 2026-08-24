/**
 * science/publish.ts — Scheduled science publication loop.
 *
 * Closes the automation gaps in the research pipeline:
 *   1. `publishFrontierDiscoveries()` — turns the highest-grade (frontier /
 *      promising) research discoveries into published articles on Overlay
 *      Global Lens (`POST /api/publish`), then drains the publication→
 *      self-learning feed so the grader learns from what actually ships.
 *   2. `refreshSciencePapers()` — refreshes the OpenAlex/PubMed literature
 *      cache for every active goal so `research-papers.json` never goes stale.
 *
 * Idempotent + fail-soft: each goal is published at most once per run window
 * (tracked in `.draymond/research-published.json`), an unreachable Global Lens
 * or a bad item never throws the cron, and nothing here depends on an LLM.
 */

import { readJsonState, writeJsonState, nowIso } from '@/lib/draymond/cognition';
import { gradeResearch, recordPublicationOutcomes, type ResearchGrade } from './research-grade';
import { refreshGoalPapers } from './papers';

export interface PublishedDiscovery {
  goalId: string;
  publishedAt: string;
  score: number;
}

export interface PublishState {
  published: PublishedDiscovery[];
  updatedAt?: string;
}

const STATE_NAME = 'research-published';

function globalLensUrl(): string {
  const raw =
    process.env.GLOBAL_LENS_URL ??
    process.env.OVERLAY_GLOBAL_LENS_URL ??
    'http://localhost:3090';
  return raw.replace(/\/+$/, '');
}

async function readPublished(): Promise<PublishState> {
  return readJsonState<PublishState>(STATE_NAME, { published: [] });
}

async function writePublished(state: PublishState): Promise<void> {
  await writeJsonState(STATE_NAME, state);
}

/** Deterministic markdown body for a frontier/promising discovery. */
function paperBody(g: ResearchGrade): string {
  const lines = [
    `# ${g.title}`,
    '',
    `**Domain:** ${g.domain} · **Area:** ${g.area} · **Breakthrough score:** ${g.score}/1000 (${g.breakthroughClass})`,
    `**Evidence tier:** ${g.evidenceTier} · **Trend:** ${g.trend}`,
    '',
    '## Why it matters',
    '',
    `This research goal grades as a **${g.breakthroughClass}** candidate (score ${g.score}/1000) in the Overlay365 science portfolio.`,
    '',
    '## Hypotheses under test',
    '',
    ...(g.hypotheses.length
      ? g.hypotheses.map((h) => `- [${h.status}] ${h.claim}`)
      : ['- _none tracked yet_']),
    '',
    '_Generated deterministically by the Overlay365 science pipeline from evidence-tiered research grades._',
  ];
  return lines.join('\n');
}

/**
 * Publish the current frontier/promising discoveries to Overlay Global Lens and
 * drain the publication→self-learning feed. Pass `force` to re-publish goals
 * that were already published (normally skipped). Never throws: per-item and
 * store failures are collected and reported.
 */
export async function publishFrontierDiscoveries(force = false): Promise<{
  graded: number;
  frontier: number;
  published: number;
  skipped: number;
  errors: string[];
  drained: number;
}> {
  const graded = await gradeResearch();
  const state = await readPublished();
  const already = new Map(state.published.map((p) => [p.goalId, p]));
  const base = globalLensUrl();
  const errors: string[] = [];
  let published = 0;
  let skipped = 0;

  for (const g of graded.discoveries) {
    if (!force && already.has(g.goalId)) {
      skipped += 1;
      continue;
    }
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (process.env.GL_PUBLISH_KEY) headers.authorization = `Bearer ${process.env.GL_PUBLISH_KEY}`;
      const res = await fetch(`${base}/api/publish`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: g.title,
          body: paperBody(g),
          category: g.domain,
          source_name: 'Overlay365 Science',
          url: '',
          paper: {
            goalId: g.goalId,
            score: g.score,
            evidenceTier: g.evidenceTier,
            breakthroughClass: g.breakthroughClass,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Global Lens HTTP ${res.status}`);
      published += 1;
      state.published.push({ goalId: g.goalId, publishedAt: nowIso(), score: g.score });
    } catch (err) {
      errors.push(`${g.goalId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  state.updatedAt = nowIso();
  await writePublished(state);

  let drained = 0;
  try {
    drained = (await recordPublicationOutcomes()).length;
  } catch {
    /* learning store best-effort */
  }

  return {
    graded: graded.grades.length,
    frontier: graded.discoveries.length,
    published,
    skipped,
    errors,
    drained,
  };
}

/** Refresh the literature cache for every active goal. */
export async function refreshSciencePapers(force = false): Promise<{ goals: number; total: number }> {
  const rows = await refreshGoalPapers(force);
  const total = rows.reduce((a, r) => a + r.count, 0);
  return { goals: rows.length, total };
}

// ---------------------------------------------------------------------------
// CLI entry: npx --yes tsx src/lib/science/publish.ts
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('publish.ts')) {
  const force = process.argv.includes('--force') || process.argv.includes('-f');
  publishFrontierDiscoveries(force)
    .then((r) => {
      console.log(
        `Graded ${r.graded} goals · ${r.frontier} frontier/promising · published ${r.published} (skipped ${r.skipped}) · learning drained ${r.drained}`
      );
      if (r.errors.length) {
        console.error('Publish errors:');
        r.errors.forEach((e) => console.error('  ' + e));
      }
    })
    .catch((e) => {
      console.error('FATAL', e);
      process.exit(1);
    });
}
