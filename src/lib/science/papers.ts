/**
 * science/papers.ts — Research literature grounding for science goals & hypotheses.
 *
 * Pulls real, keyless academic papers (OpenAlex + PubMed E-utilities) for each
 * goal's topic, caches them in `.draymond/research-papers.json` (JSON-state
 * registry pattern), and exposes them so experiments can cite real evidence.
 *
 * Deterministic + source-grounded: every paper stores id/title/url/year/authors.
 * No LLM, no API keys, no fabrication. Degrades gracefully offline (cache only).
 */

import { readJsonState, writeJsonState, nowIso } from "@/lib/draymond/cognition";
import { listGoals, listHypotheses } from "./goals";

export interface Paper {
  id: string;
  source: "openalex" | "pubmed";
  title: string;
  url: string;
  year?: string | number;
  authors: string;
  summary: string;
}

export interface PapersState {
  papers: Record<string, Paper[]>;
  fetchedAt?: string;
}

const STATE_NAME = "research-papers";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_PER_TOPIC = 6;
const CACHE_MS = 24 * 60 * 60 * 1000; // refresh at most once/day per topic

// ---------------------------------------------------------------------------
// Keyless sources
// ---------------------------------------------------------------------------

async function openalexSearch(query: string, perPage = MAX_PER_TOPIC): Promise<Paper[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(perPage));
  url.searchParams.set("sort", "relevance_score:desc");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
    return (data.results ?? []).map((w) => ({
      id: String(w.id ?? ""),
      source: "openalex" as const,
      title: String(w.title ?? ""),
      url: String((w.doi as string) || `https://openalex.org/${String(w.id ?? "").split("/").pop()}`),
      year: (w.publication_year as number) ?? undefined,
      authors: ((w.authorships as Array<{ author?: { display_name?: string } }>) ?? [])
        .slice(0, 3)
        .map((a) => a.author?.display_name ?? "")
        .filter(Boolean)
        .join(", "),
      summary: String(w.publication_year ?? ""),
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function pubmedSearch(query: string, maxResults = MAX_PER_TOPIC): Promise<Paper[]> {
  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  searchUrl.searchParams.set("db", "pubmed");
  searchUrl.searchParams.set("term", query);
  searchUrl.searchParams.set("retmode", "json");
  searchUrl.searchParams.set("retmax", String(maxResults));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(searchUrl.toString(), { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { esearchresult?: { idlist?: string[] } };
    const ids = data.esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];
    const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
    summaryUrl.searchParams.set("db", "pubmed");
    summaryUrl.searchParams.set("id", ids.join(","));
    summaryUrl.searchParams.set("retmode", "json");
    const res2 = await fetch(summaryUrl.toString(), { signal: ctrl.signal });
    if (!res2.ok) return [];
    const sdata = (await res2.json()) as { result?: Record<string, Record<string, unknown>> };
    const result = sdata.result ?? {};
    return ids
      .map((id) => result[id])
      .filter(Boolean)
      .map((rec) => ({
        id: `pubmed:${rec.id}`,
        source: "pubmed" as const,
        title: String(rec.title ?? ""),
        url: `https://pubmed.ncbi.nlm.nih.gov/${rec.id}/`,
        year: String(rec.pubdate ?? ""),
        authors: ((rec.authors as Array<{ name?: string }>) ?? [])
          .slice(0, 3)
          .map((a) => a.name ?? "")
          .filter(Boolean)
          .join(", "),
        summary: String(rec.source ?? ""),
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch papers for one topic across both keyless sources, deduped by title. */
export async function fetchPapersForTopic(topic: string, max = MAX_PER_TOPIC): Promise<Paper[]> {
  const trimmed = topic.trim();
  if (!trimmed) return [];
  const [oa, pm] = await Promise.all([openalexSearch(trimmed, max), pubmedSearch(trimmed, max)]);
  const seen = new Set<string>();
  const merged: Paper[] = [];
  for (const p of [...oa, ...pm]) {
    const key = p.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
    if (merged.length >= max) break;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Cached store (JSON-state registry pattern)
// ---------------------------------------------------------------------------

async function readPapers(): Promise<PapersState> {
  return readJsonState<PapersState>(STATE_NAME, { papers: {} });
}

async function writePapers(state: PapersState): Promise<void> {
  await writeJsonState(STATE_NAME, state);
}

/**
 * Refresh papers for all active goals. Each goal's topic is derived from its
 * area + title so experiments get real, relevant literature grounding. Honors
 * the 24h cache per topic unless `force` is set.
 */
export async function refreshGoalPapers(force = false): Promise<{ goalId: string; topic: string; count: number }[]> {
  const goals = await listGoals();
  const state = await readPapers();
  const now = Date.now();
  const results: { goalId: string; topic: string; count: number }[] = [];

  for (const goal of goals) {
    if (goal.status !== "active") continue;
    const topic = `${goal.area} ${goal.title}`.slice(0, 140);
    const existing = state.papers[goal.id] ?? [];
    // Cache: skip refresh if already fetched recently and non-empty.
    const freshEnough =
      !force && state.fetchedAt && now - Date.parse(state.fetchedAt) < CACHE_MS && existing.length > 0;
    if (freshEnough) {
      results.push({ goalId: goal.id, topic, count: existing.length });
      continue;
    }
    const papers = await fetchPapersForTopic(topic);
    state.papers[goal.id] = papers.length > 0 ? papers : existing;
    results.push({ goalId: goal.id, topic, count: papers.length > 0 ? papers.length : existing.length });
  }

  state.fetchedAt = nowIso();
  await writePapers(state);
  return results;
}

/** Get cached papers for a goal (fallback: empty). */
export async function papersForGoal(goalId: string): Promise<Paper[]> {
  const state = await readPapers();
  return state.papers[goalId] ?? [];
}

/** Count papers per goal for reporting. */
export async function papersSummary(): Promise<{ goalId: string; count: number }[]> {
  const state = await readPapers();
  return Object.entries(state.papers).map(([goalId, ps]) => ({ goalId, count: ps.length }));
}

/** Map the latest 1-2 papers for a hypothesis' claim onto a short evidence line. */
export async function hypothesisPaperEvidence(hypothesisId: string): Promise<string[]> {
  const hyps = await listHypotheses();
  const hyp = hyps.find((h) => h.id === hypothesisId);
  if (!hyp) return [];
  const goal = (await listGoals()).find((g) => g.id === hyp.goal_id);
  const papers = await papersForGoal(hyp.goal_id);
  const topical = papers.filter((p) => {
    const t = `${p.title} ${p.summary}`.toLowerCase();
    const words = hyp.claim.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    return words.some((w) => t.includes(w));
  });
  const chosen = (topical.length > 0 ? topical : papers).slice(0, 2);
  return chosen.map((p) => `${p.title} (${p.source}, ${goal?.area ?? ""}) — ${p.url}`);
}

// ---------------------------------------------------------------------------
// CLI entry: npx --yes tsx src/lib/science/papers.ts --refresh
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith("papers.ts")) {
  const force = process.argv.includes("--refresh") || process.argv.includes("-f");
  refreshGoalPapers(force)
    .then((rows) => {
      console.log(`Refreshed papers for ${rows.length} goals${force ? " (forced)" : ""}:`);
      rows.forEach((r) => console.log(`  ${r.goalId}: ${r.topic.slice(0, 60)}… → ${r.count} papers`));
      return papersSummary();
    })
    .then((sum) => {
      const total = sum.reduce((acc, s) => acc + s.count, 0);
      console.log(`TOTAL cached papers: ${total}`);
    })
    .catch((e) => {
      console.error("FATAL", e);
      process.exit(1);
    });
}
