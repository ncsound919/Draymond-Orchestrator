// ============================================================================
// GitHub-Awesome weekly tool-intake scan (Workstream B, plan
// plans/2026-08-26-github-awesome-tool-intake.md).
//
// Pipeline: resolve latest weekly episode → fetch transcript → extract tool
// candidates → score via Dev-Brain POST /api/intake (deterministic) → append
// .draymond/tool-intake.json → kairos opportunity + hypothesis handoff.
//
// Deterministic: no LLM. Transcript fetch shells out to Py3.12 youtube-
// transcript-api; scoring is Dev-Brain's CandidateTriageEngine rubric.
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const REGISTRY_DIR = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond');
const CHANNEL_ID = process.env.GITHUB_AWESOME_CHANNEL_ID ?? 'UC9Rrud-8CaHokDtK9FszvRg';
const DEV_BRAIN_URL = process.env.DEV_BRAIN_URL ?? 'http://localhost:3450';
const PYTHON = process.env.PYTHON_BIN ?? 'python';

export interface IntakeToolCandidate {
  name: string;
  description: string;
  repo?: string;
  license?: string;
  stars?: number;
  language?: string;
  platform?: string;
  tags?: string[];
}

export interface IntakeScanResult {
  episode: { title: string; videoId: string; publishedAt?: string } | null;
  transcript: string;
  candidates: IntakeToolCandidate[];
  ranked: Array<Record<string, unknown>>;
  topPicks: Array<Record<string, unknown>>;
  pruned: Array<Record<string, unknown>>;
  pulled: string[];
  handoff: { kairos: boolean; hypotheses: boolean; appended: boolean };
}

// ── Episode resolution ───────────────────────────────────────────────────────

/** Latest uploads for the channel via the public YouTube RSS feed. */
export function fetchChannelFeed(channelId: string): Array<{ videoId: string; title: string; publishedAt: string }> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const py = `import sys;sys.stdout.reconfigure(encoding='utf-8',errors='replace');import urllib.request;print(urllib.request.urlopen(sys.argv[1],timeout=30).read().decode('utf-8'))`;
  const xml = execFileSync(PYTHON, ['-c', py, url], { timeout: 60_000, encoding: 'utf8' });
  const idRe = /<yt:videoId>([^<]+)<\/yt:videoId>/g;
  const titleRe = /<media:title>([^<]+)<\/media:title>/g;
  const pubRe = /<published>([^<]+)<\/published>/g;
  const videos: Array<{ videoId: string; title: string; publishedAt: string }> = [];
  const ids = [...xml.matchAll(idRe)].map((m) => m[1]);
  const titles = [...xml.matchAll(titleRe)].map((m) => m[1]);
  const pubs = [...xml.matchAll(pubRe)].map((m) => m[1]);
  for (let i = 0; i < ids.length; i++) {
    videos.push({ videoId: ids[i], title: titles[i] ?? '', publishedAt: pubs[i] ?? '' });
  }
  return videos;
}

/** Newest "GitHub Trending Weekly" episode on the channel. */
export function resolveLatestWeekly(): { title: string; videoId: string; publishedAt?: string } | null {
  const videos = fetchChannelFeed(CHANNEL_ID);
  const weekly = videos.find((v) => /weekly/i.test(v.title));
  return weekly ? { title: weekly.title, videoId: weekly.videoId, publishedAt: weekly.publishedAt } : null;
}

// ── Transcript ───────────────────────────────────────────────────────────────

/** Pulls the (English auto) transcript for a video via Py3.12 youtube-transcript-api. */
export function fetchTranscript(videoId: string): string {
  const py = [
    'import sys;sys.stdout.reconfigure(encoding="utf-8",errors="replace");',
    'from youtube_transcript_api import YouTubeTranscriptApi;',
    'api=YouTubeTranscriptApi();',
    `t=api.fetch('${videoId}');`,
    "print('\\n'.join(s.text for s in t.snippets))",
  ].join(' ');
  return execFileSync(PYTHON, ['-c', py], { timeout: 90_000, encoding: 'utf8' });
}

// ── Tool extraction ──────────────────────────────────────────────────────────

const FILLER_STARTS = new Set([
  'this', 'that', 'these', 'those', 'it', 'its', 'the', 'a', 'an', 'and', 'but', 'so',
  'or', 'then', 'here', 'there', 'welcome', 'github', 'no', 'every', 'most', 'some',
  'each', 'any', 'all', 'both', 'each', 'one', 'two', 'what', 'why', 'how', 'when',
  'while', 'where', 'we', 'they', 'you', 'your', 'our', 'their', 'his', 'her', 'its',
  'this', 'let', 'lets', 'im', 'dont', 'not', 'rather', 'instead', 'above', 'below',
]);

/** Normalize transcript fragments into sentences. */
function toSentences(transcript: string): string[] {
  const text = transcript.replace(/\s+/g, ' ').replace(/([.!?])\s+/g, '$1\n');
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 12 && /[a-z]{2,}/i.test(s));
}

/** Map description keywords → intake tags so scoring differentiates tools. */
const TAG_KEYWORDS: Array<[string, string]> = [
  ['memory', 'memory'], ['rag', 'rag'], ['graph', 'graph'], ['knowledge', 'knowledge'],
  ['vector', 'vector'], ['embedding', 'rag'], ['security', 'security'], ['governance', 'governance'],
  ['mcp', 'mcp'], ['audit', 'audit'], ['voice', 'voice'], ['speech', 'stt'], ['stt', 'stt'],
  ['transcri', 'stt'], ['email', 'email'], ['mailbox', 'mailbox'], ['smtp', 'email'],
  ['fitness', 'fitness'], ['exercise', 'fitness'], ['health', 'health'],
  ['sandbox', 'sandbox'], ['container', 'container'], ['code', 'code'], ['agent', 'agent'],
  ['orchestrat', 'orchestration'], ['workflow', 'workflow'], ['research', 'research'],
  ['finance', 'finance'], ['music', 'music'], ['marketing', 'marketing'], ['course', 'learning'],
  ['gym', 'fitness'], ['database', 'database'], ['search', 'search'], ['ocr', 'ocr'],
];

export function inferTags(description: string): string[] {
  const d = description.toLowerCase();
  const tags: string[] = [];
  for (const [kw, tag] of TAG_KEYWORDS) {
    if (d.includes(kw) && !tags.includes(tag)) tags.push(tag);
  }
  return tags.length ? tags : ['tool'];
}

/**
 * Heuristic tool-name extraction tuned to the Github Awesome script style:
 * a short capitalized phrase immediately followed by an action verb.
 */
export function extractToolCandidates(transcript: string): IntakeToolCandidate[] {
  const candidates: IntakeToolCandidate[] = [];
  const seen = new Set<string>();
  for (const sentence of toSentences(transcript)) {
    const m = sentence.match(/^([A-Z][A-Za-z0-9'\-\. ]{1,44}?)\s+(is|does|packages|puts|gives|turns|searches|keeps|starts|reads|uses|ships|builds|handles|runs|spans|trains|routes|brings|pins|shows|watches|packs|adds|writes|makes|draws|finds|lets|boots|answers|transcribes|looks|scores|teaches|grows|opens|claims|treats|helps|scaffolds|creates|offers|sells)\s/i);
    if (!m) continue;
    const rawName = m[1].trim();
    const first = rawName.split(' ')[0].toLowerCase();
    if (FILLER_STARTS.has(first)) continue;
    const name = rawName.replace(/\.$/, '');
    const key = name.toLowerCase();
    if (name.length < 2 || name.length > 48) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const desc = sentence.slice(m[0].length).trim().split(/\.\s+[A-Z]/)[0];
    const fullDesc = (m[0].trim() + ' ' + desc).slice(0, 220);
    candidates.push({ name, description: fullDesc, tags: inferTags(fullDesc) });
  }
  return candidates;
}

// ── Scoring via Dev-Brain ────────────────────────────────────────────────────

export interface IntakeScored {
  ranked: Array<Record<string, unknown>>;
  topPicks: Array<Record<string, unknown>>;
  pruned: Array<Record<string, unknown>>;
  pulled: string[];
}

export async function scoreCandidates(candidates: IntakeToolCandidate[]): Promise<IntakeScored> {
  const body = JSON.stringify({
    tools: candidates.map((c) => ({
      name: c.name,
      description: c.description,
      repo: c.repo,
      license: c.license,
      stars: c.stars,
      language: c.language,
      platform: c.platform,
      tags: c.tags ?? ['tool'],
    })),
    strategy: 'balanced_pareto',
    problem: `GitHub-Awesome weekly scan: ${candidates.length} candidate open-source tools for the Overlay365 fleet.`,
  });
  const res = await fetch(`${DEV_BRAIN_URL}/api/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Dev-Brain /api/intake failed: HTTP ${res.status}`);
  const data = (await res.json()) as IntakeScored & { topPicks?: Array<{ title: string }> };
  const pulled = (data.topPicks ?? [])
    .filter((t) => Number(t.compositeTriageScore) >= 80)
    .map((t) => String(t.title));
  return { ranked: data.ranked ?? [], topPicks: data.topPicks ?? [], pruned: data.pruned ?? [], pulled };
}

// ── Brain-state handoff ──────────────────────────────────────────────────────

function readJson(file: string): Record<string, unknown> {
  const p = path.join(REGISTRY_DIR, file);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function writeJson(file: string, data: unknown): void {
  const p = path.join(REGISTRY_DIR, file);
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

const nowIso = () => new Date().toISOString();
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Append one episode's intake to .draymond/tool-intake.json (append-only). */
export function appendIntakeLedger(result: IntakeScanResult): void {
  const ledger = readJson('tool-intake.json');
  const entries = (Array.isArray(ledger.entries) ? ledger.entries : []) as Array<Record<string, unknown>>;
  const seen = new Set(entries.map((e) => e.id as string));
  const newEntries = result.candidates
    .filter((c) => !seen.has(`ti-${slugify(c.name)}`))
    .map((c, i) => {
      const scored = result.ranked.find((r) => String(r.title) === c.name);
      return {
        id: `ti-${slugify(c.name)}`,
        source: 'github-awesome-weekly',
        date: nowIso().slice(0, 10),
        tool: c.name,
        repo: c.repo ?? '',
        license: c.license ?? '',
        verdict: result.pulled.includes(c.name) ? 'pull' : 'monitor',
        fit: c.description.slice(0, 160),
        owner: '',
        status: scored ? String(scored.status) : 'unranked',
        note: `scan ${result.episode?.title ?? 'unknown'} (index ${i})`,
      };
    });
  if (newEntries.length) {
    ledger.entries = [...entries, ...newEntries];
    ledger.updatedAt = nowIso();
    writeJson('tool-intake.json', ledger);
  }
}

/** Emit one kairos opportunity for the top pull candidate. */
export function appendKairosOpportunity(result: IntakeScanResult): boolean {
  const top = result.topPicks[0] as { title?: string; compositeTriageScore?: number } | undefined;
  if (!top?.title) return false;
  const kairos = readJson('kairos.json');
  const moments = (Array.isArray(kairos.moments) ? kairos.moments : []) as Array<Record<string, unknown>>;
  const hash = `github-awesome:${slugify(String(top.title))}`;
  const existing = moments.some((m) => m.hash === hash);
  if (existing) return false;
  moments.unshift({
    id: `km_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: 'opportunity',
    severity: 'info',
    title: `Tool-intake: ${top.title} (${top.compositeTriageScore}/100)`,
    detail: `GitHub-Awesome weekly scan surfaced ${result.pulled.length} pull candidate(s). Top: ${top.title} — add to a pillar or wire as a fleet tool.`,
    source: 'github-awesome-scan',
    firstSeen: nowIso(),
    lastSeen: nowIso(),
    occurrences: 1,
    hash,
    acked: false,
  });
  kairos.moments = moments;
  kairos.updatedAt = nowIso();
  writeJson('kairos.json', kairos);
  return true;
}

/** Add a hypothesis for the top pull candidate to the research backlog. */
export function appendIntakeHypothesis(result: IntakeScanResult): boolean {
  const top = result.topPicks[0] as { title?: string; description?: string } | undefined;
  if (!top?.title) return false;
  const hypotheses = readJson('hypotheses.json');
  const list = (Array.isArray(hypotheses.hypotheses) ? hypotheses.hypotheses : []) as Array<Record<string, unknown>>;
  const id = `ga-${slugify(String(top.title))}-h1`;
  if (list.some((h) => h.id === id)) return false;
  list.push({
    id,
    goal_id: 'tooling-intake',
    claim: `${top.title}: ${(top.description ?? 'candidate open-source tool').slice(0, 180)}`,
    status: 'untested',
    experiment_ids: [],
    lifecycle: 'queued',
    lifecycleUpdatedAt: nowIso(),
  });
  hypotheses.hypotheses = list;
  hypotheses.updatedAt = nowIso();
  writeJson('hypotheses.json', hypotheses);
  return true;
}

// ── Orchestration ────────────────────────────────────────────────────────────

export async function runGithubAwesomeScan(opts?: {
  videoId?: string;
  transcript?: string;
  quiet?: boolean;
}): Promise<IntakeScanResult> {
  const episode = opts?.videoId
    ? { title: 'manual video', videoId: opts.videoId }
    : opts?.transcript
      ? { title: 'transcript override', videoId: 'override' }
      : resolveLatestWeekly();
  if (!episode) throw new Error('No "GitHub Trending Weekly" episode found in the channel feed.');

  const transcript = opts?.transcript ?? fetchTranscript(episode.videoId);
  const candidates = extractToolCandidates(transcript);

  let ranked: Array<Record<string, unknown>> = [];
  let topPicks: Array<Record<string, unknown>> = [];
  let pruned: Array<Record<string, unknown>> = [];
  let pulled: string[] = [];
  try {
    const scored = await scoreCandidates(candidates);
    ranked = scored.ranked;
    topPicks = scored.topPicks;
    pruned = scored.pruned;
    pulled = scored.pulled;
  } catch (err) {
    if (!opts?.quiet) console.warn(`[github-awesome-scan] Dev-Brain intake skipped: ${(err as Error).message}`);
  }

  const result: IntakeScanResult = {
    episode,
    transcript,
    candidates,
    ranked,
    topPicks,
    pruned,
    pulled,
    handoff: { kairos: false, hypotheses: false, appended: false },
  };

  result.handoff.appended = result.candidates.length > 0;
  appendIntakeLedger(result);
  result.handoff.kairos = appendKairosOpportunity(result);
  result.handoff.hypotheses = appendIntakeHypothesis(result);

  return result;
}