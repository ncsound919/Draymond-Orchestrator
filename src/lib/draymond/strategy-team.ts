// ============================================================================
// STRATEGY TEAM — run the Overlay Strategist (weeklyScan / intel / scout /
// strategist) from Draymond as a scheduled, self-contained team.
// ============================================================================
// The Strategist lives at 01_Platforms/Overlay365/agent-team/agents/strategist/
// and exposes a JSON-in/JSON-out CLI (serve.ts). Draymond spawns it with `npx
// tsx serve.ts --input=<file>` (same invocation as /api/strategy/run), feeds it
// live registry data (entities + chains) so venture scans compose real recipes,
// and surfaces the result. Bounded + deterministic: 90s timeout, one request
// in / one response out, never throws (best-effort, reported).
// ============================================================================

import { execFile, exec } from 'node:child_process';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createDraymondAdminClient } from './client';
import { getEntity } from './registry';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export type StrategyMode = 'weeklyScan' | 'intel' | 'scout' | 'strategist';

/** Agent-team dir (matches /api/strategy/run; AGENT_TEAM_DIR env overrides). */
export function agentTeamDir(): string {
  if (process.env.AGENT_TEAM_DIR) return process.env.AGENT_TEAM_DIR;
  return path.resolve(process.cwd(), '..', '01_Platforms', 'Overlay365', 'agent-team');
}

const RUN_TIMEOUT_MS = 90_000;

/** Minimal shapes the strategist consumes (mirror of agent-team shared types). */
export interface StrategistEvidence {
  id: string;
  source: string;
  platform: 'health' | 'wealth' | 'justice' | 'cross-platform';
  rawText: string;
  timestamp: string;
  channel: string;
  metadata: Record<string, unknown>;
  confidence: 'high' | 'low';
}
export interface StrategistTrend { date: string; value: number; [k: string]: unknown; }
export interface StrategistAnomaly { series: string; [k: string]: unknown; }
export interface StrategistHidden { source: string; terms: string[]; assets: string[]; }
export interface StrategistAsset { slug: string; capabilities: string[]; }

export interface StrategyTeamRunInput {
  mode: StrategyMode;
  periodStart?: string;
  periodEnd?: string;
  feedback?: StrategistEvidence[];
  trends?: StrategistTrend[];
  anomalies?: StrategistAnomaly[];
  hiddenInputs?: StrategistHidden[];
  assets?: StrategistAsset[];
  existingChains?: string[];
  supportEmailFile?: string;
}

/** Feed live Draymond registry data (entities + chains) into a scan so the
 * scout composes proposals referencing real entity slugs. Best-effort: on any
 * registry failure, return empty lists (the strategist still runs). */
export async function liveStrategyAssets(): Promise<{ assets: StrategistAsset[]; existingChains: string[] }> {
  try {
    const supabase = createDraymondAdminClient();
    const [entities, chains] = await Promise.all([
      supabase.from('draymond_entities').select('slug, capabilities'),
      supabase.from('draymond_chains').select('slug, name').eq('is_template', true),
    ]);
    const assets: StrategistAsset[] = (entities?.data ?? []).map((e: { slug: string; capabilities?: string[] }) => ({
      slug: e.slug,
      capabilities: e.capabilities ?? [],
    }));
    const existingChains = (chains?.data ?? [])
      .map((c: { slug?: string; name?: string }) => c.slug ?? c.name ?? '')
      .filter(Boolean);
    return { assets, existingChains };
  } catch {
    return { assets: [], existingChains: [] };
  }
}

/** Run one strategist mode via the serve.ts CLI (JSON in → JSON out). */
export async function runStrategyMode(input: StrategyTeamRunInput): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  const dir = agentTeamDir();
  try {
    await /*turbopackIgnore: true*/ stat(dir);
  } catch {
    return { ok: false, error: `agent-team not found at ${dir}` };
  }

  let tmpDir: string | null = null;
  try {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'strategy-team-'));
    const inputFile = path.join(tmpDir, 'request.json');
    await writeFile(inputFile, JSON.stringify(input), 'utf-8');

    const serveRel = path.join('agents', 'strategist', 'serve.ts');
    const inputRel = `--input=${inputFile}`;
    // win32: npx is a .cmd shim — execFile cannot spawn it directly (ENOENT).
    // Route through cmd.exe /c like /api/strategy/run does. npx tsx resolves
    // from the agent-team dir; the workspace root also has tsx in node_modules.
    const cmd = `npx tsx ${serveRel} "${inputRel}"`;
    const { stdout } = await (process.platform === 'win32'
      ? execAsync(cmd, { cwd: dir, timeout: RUN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, windowsHide: true })
      : execFileAsync('npx', ['tsx', serveRel, inputRel], { cwd: dir, timeout: RUN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, windowsHide: true }));

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { ok: false, error: 'unparseable output from strategy runner' };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 800) };
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Weekly venture scan (weeklyScan): intel + scout, fed live registry assets.
 * Returns the brief, proposals, and auto/review counts. */
export async function runWeeklyScan(opts: {
  periodStart?: string;
  periodEnd?: string;
  hiddenInputs?: StrategistHidden[];
  feedback?: StrategistEvidence[];
  dryRun?: boolean;
}): Promise<{ ok: boolean; error?: string; summary?: Record<string, unknown>; devBrain?: unknown }> {
  const { assets, existingChains } = await liveStrategyAssets();
  // Wire live evidence (GitHub issues) + trends (Umami) unless caller supplied.
  const { feedback, trends } = opts.feedback
    ? { feedback: opts.feedback, trends: [] as StrategistTrend[] }
    : await liveStrategyFeed(opts.periodStart ?? '', opts.periodEnd ?? '');
  const res = await runStrategyMode({
    mode: 'weeklyScan',
    periodStart: opts.periodStart,
    periodEnd: opts.periodEnd,
    hiddenInputs: opts.hiddenInputs,
    feedback,
    trends,
    assets,
    existingChains,
  });
  if (!res.ok) return { ok: false, error: res.error };
  const d = (res.data ?? {}) as { brief?: unknown; proposals?: unknown[]; autoCount?: number; reviewCount?: number };

  // -- Dev-Brain scoring: weight proposals deterministically before returning --
  // Never blocks the scan: if Dev-Brain is down, the raw proposals are still
  // returned (best-effort, advisory layer).
  let devBrain: unknown = null;
  if (Array.isArray(d.proposals) && d.proposals.length >= 2) {
    try {
      devBrain = await rankProposalsViaDevBrain(d.proposals);
    } catch { /* advisory only */ }
  }

  return {
    ok: true,
    summary: {
      mode: 'weeklyScan',
      dryRun: opts.dryRun ?? false,
      assets: assets.length,
      existingChains: existingChains.length,
      feedbackItems: feedback.length,
      trendPoints: trends.length,
      autoCount: d.autoCount ?? 0,
      reviewCount: d.reviewCount ?? 0,
      proposals: d.proposals?.length ?? 0,
      devBrainScored: Boolean(devBrain),
    },
    devBrain,
  };
}

/** Strategist report (strategist): feedback clustering + roadmap priorities. */
export async function runStrategistReport(opts: {
  periodStart: string;
  periodEnd: string;
  feedback?: StrategistEvidence[];
}): Promise<{ ok: boolean; error?: string; summary?: Record<string, unknown> }> {
  // Wire live GitHub feedback unless caller supplied.
  const { feedback } = opts.feedback
    ? { feedback: opts.feedback }
    : await liveStrategyFeed(opts.periodStart, opts.periodEnd);
  const res = await runStrategyMode({
    mode: 'strategist',
    periodStart: opts.periodStart,
    periodEnd: opts.periodEnd,
    feedback,
  });
  if (!res.ok) return { ok: false, error: res.error };
  const d = (res.data ?? {}) as { report?: { coverage?: { totalItemsProcessed: number }; clusters?: unknown[]; recommendations?: string[]; flags?: string[] } };
  return {
    ok: true,
    summary: {
      mode: 'strategist',
      periodStart: opts.periodStart,
      periodEnd: opts.periodEnd,
      items: d.report?.coverage?.totalItemsProcessed ?? 0,
      clusters: d.report?.clusters?.length ?? 0,
      recommendations: d.report?.recommendations?.length ?? 0,
      flags: d.report?.flags ?? [],
    },
  };
}

/** Register an entity slug check helper (re-export so callers can verify the
 * strategist is fed real entity slugs without importing registry directly). */
export { getEntity };

// ============================================================================
// DEV-BRAIN STRATEGY SCORING — deterministic venture ranking (advisory)
// ============================================================================

/** Rank scout proposals via Dev-Brain's deterministic matrix. Never throws. */
export async function rankProposalsViaDevBrain(
  proposals: unknown[],
): Promise<{ matrix: unknown; rankedIds: string[] } | null> {
  if (!Array.isArray(proposals) || proposals.length < 2) return null;
  try {
    const { devBrainStrategyDecide } = await import('./dev-brain');
    const candidates = proposals.slice(0, 12).map((p: unknown, i: number) => {
      const obj = p as Record<string, unknown>;
      const title = (obj.title as string) || (obj.slug as string) || `proposal-${i}`;
      const desc = (obj.description as string) || (obj.rationale as string) || (obj.summary as string) || String(p).slice(0, 300);
      return { id: `venture:${title}`, title, description: desc.slice(0, 400), tags: ['strategy', 'venture', 'proposal'] };
    });
    const matrix = await devBrainStrategyDecide({
      problem: 'Strategy venture ranking: 90-day six-figure revenue engine fit (E1-platform, E2-b2b, E3-tooling, E4-vertical) + durable moat and execution speed. Highest weight = ship first.',
      candidates,
      strategy: 'capital_efficiency',
    });
    if (!matrix) return null;
    const rankedIds = [...matrix.options]
      .sort((a, b) => b.weightPercentage - a.weightPercentage)
      .map(o => o.id);
    return { matrix, rankedIds };
  } catch {
    return null;
  }
}

// ============================================================================
// LIVE FEED SOURCES — wire real evidence into the strategist so it produces
// actual findings (not "no signals this cycle").
// ============================================================================

/** Fetch live GitHub issues from the verified repos (via the strategist's own
 * source adapter). Returns EvidenceItem[] or [] on failure (best-effort). */
export async function fetchGithubFeedback(periodStart: string, periodEnd: string): Promise<StrategistEvidence[]> {
  try {
    const { fetchGithubIssues } = await import(
      pathToFileURL(path.join(agentTeamDir(), 'agents', 'strategist', 'sources', 'githubIssues.ts')).href
    );
    const { DEFAULT_GITHUB_CONFIG } = await import(
      pathToFileURL(path.join(agentTeamDir(), 'agents', 'strategist', 'sources', 'githubRepos.ts')).href
    );
    // Use a GitHub PAT from env if present (GITHUB_PAT_NCSOUND or GITHUB_PAT) —
    // unauthenticated API is 60 req/hr and the weekly scan burns it fast.
    const token = process.env.GITHUB_PAT_NCSOUND || process.env.GITHUB_PAT || '';
    const config = token ? { ...DEFAULT_GITHUB_CONFIG, token } : DEFAULT_GITHUB_CONFIG;
    const items = await fetchGithubIssues(config, periodStart, periodEnd);
    return items as unknown as StrategistEvidence[];
  } catch (err) {
    // Best-effort: log the failure reason so it is not silent.
    console.error('[strategy-team] fetchGithubFeedback failed:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/** Query Umami (UMAMI_URL) for event counts — the trend feed for the
 * strategist's trend/anomaly detectors. Uses the events endpoint (confirmed to
 * return real stored events). Returns TrendPoint[] or [] on failure. */
export async function fetchUmamiTrends(periodStart: string, periodEnd: string): Promise<StrategistTrend[]> {
  const umamiUrl = process.env.UMAMI_URL?.replace(/\/$/, '') ?? 'http://localhost:3003';
  const token = process.env.UMAMI_TOKEN ?? '';
  try {
    if (!token) return [];
    const headers = { authorization: `Bearer ${token}` };
    const sitesRes = await fetch(`${umamiUrl}/api/websites`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!sitesRes.ok) return [];
    const sitesBody = (await sitesRes.json()) as { data?: Array<{ id: string }> };
    const sites = sitesBody.data ?? [];
    if (sites.length === 0) return [];
    const siteId = sites[0].id;
    const start = new Date(periodStart).getTime();
    const end = new Date(periodEnd).getTime();
    const eventsRes = await fetch(
      `${umamiUrl}/api/websites/${siteId}/events?startAt=${start}&endAt=${end}`,
      { headers, signal: AbortSignal.timeout(15_000) }
    );
    if (!eventsRes.ok) return [];
    const body = (await eventsRes.json()) as { data?: unknown[] };
    const events = body.data ?? [];
    // Single aggregate point of total tracked events — the strategist's trend
    // detector tolerates a 1-point series; per-day breakdown is wired later.
    return [{ date: periodStart.slice(0, 10), value: events.length }];
  } catch {
    return [];
  }
}

/** Fetch live evidence + trends for a strategist run. Best-effort: returns the
 * data that succeeded; missing sources yield [] (strategist still runs). */
export async function liveStrategyFeed(periodStart: string, periodEnd: string): Promise<{
  feedback: StrategistEvidence[];
  trends: StrategistTrend[];
}> {
  const [feedback, trends] = await Promise.all([
    fetchGithubFeedback(periodStart, periodEnd),
    fetchUmamiTrends(periodStart, periodEnd),
  ]);
  return { feedback, trends };
}
