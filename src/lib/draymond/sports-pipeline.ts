/**
 * draymond/sports-pipeline.ts — Scheduled NBA analytics + bankroll automation.
 *
 * Closes the gaps between the sports_science research engine, Sports Steve's
 * betting/bankroll store, and the Draymond brain:
 *   - `ingestNbaStats()` — runs the sports_science metrics pipeline over the
 *     NBA dataset profiles (injury risk, availability, TER) so the research
 *     engine always has current evidence, and optionally pulls live NBA
 *     player game logs (stats.nba.com) for configured players.
 *   - `bankrollPulse()` — surfaces Sports Steve's bankroll / P&L / bets into
 *     `.draymond/sports-bankroll.json` so the treasury and business pipeline
 *     can see real betting revenue, not just an offline SQLite store.
 *
 * Both are deterministic, fail-soft and never throw: an unreachable Sports
 * Steve, a blocked stats API, or a missing Python runtime degrade to a
 * recorded skip, never a scheduler failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeJsonState, nowIso } from '@/lib/draymond/cognition';

const runFile = promisify(execFile);

function repoRoot(): string {
  if (process.env.SCIENCE_ROOT) return process.env.SCIENCE_ROOT;
  return path.resolve(/* turbopackIgnore: true */ process.cwd());
}

function pythonCommand(): string {
  return process.env.SCIENCE_PYTHON ?? 'python';
}

function steveUrl(): string {
  return (process.env.SPORTS_STEVE_URL ?? 'http://localhost:8010').replace(/\/+$/, '');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ============================================================================
// NBA stats ingest
// ============================================================================

export interface NbaPlayerMetrics {
  profile: string;
  sport: string;
  ter?: number;
  fatigue?: number;
  injuryRisk?: number;
  availability?: number;
  availabilityTier?: string;
  recoveryPriority?: string;
  evidenceTier?: string;
  error?: string;
}

export interface NbaIngestResult {
  ok: boolean;
  profilesFound: number;
  computed: number;
  liveFetched: number;
  players: NbaPlayerMetrics[];
  liveErrors: string[];
  reason?: string;
}

/** Run the sports_science metrics pipeline over every NBA profile dataset. */
export async function ingestNbaStats(limit = 12): Promise<NbaIngestResult> {
  const root = repoRoot();
  const profilesDir = path.join(root, 'datasets', 'sports', 'nba', 'profiles');
  let files: string[] = [];
  try {
    files = fs.readdirSync(profilesDir).filter((f) => f.endsWith('.json'));
  } catch {
    return { ok: false, profilesFound: 0, computed: 0, liveFetched: 0, players: [], liveErrors: [], reason: 'NBA dataset profiles not found' };
  }

  const players: NbaPlayerMetrics[] = [];
  let computed = 0;
  for (const file of files.slice(0, limit)) {
    const dataset = path.join(profilesDir, file);
    try {
      const { stdout } = await runFile(pythonCommand(), ['sports_science/run_metrics.py', 'nba', 'nba', dataset], {
        cwd: root,
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout.trim());
      if (parsed.error) throw new Error(String(parsed.error));
      players.push({
        profile: file,
        sport: String(parsed.sport ?? 'nba'),
        ter: parsed.ter,
        fatigue: parsed.fatigue,
        injuryRisk: parsed.injury_risk,
        availability: parsed.availability,
        availabilityTier: parsed.availability_tier,
        recoveryPriority: parsed.recovery_priority,
        evidenceTier: parsed.evidence_tier,
      });
      computed += 1;
    } catch (err) {
      players.push({ profile: file, sport: 'nba', error: errorMessage(err) });
    }
  }

  // Optional live game-log fetch for configured NBA players (id:season list).
  const liveSpec = (process.env.NBA_STATS_PLAYERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const liveErrors: string[] = [];
  let liveFetched = 0;
  for (const spec of liveSpec.slice(0, 8)) {
    const [playerId, season] = spec.split(':');
    if (!playerId || !season) continue;
    const inline = [
      'from sports_science.ingest import fetch_nba_player_game_log',
      `rows = fetch_nba_player_game_log(${JSON.stringify(playerId)}, ${JSON.stringify(season)})`,
      'import json; print(json.dumps(rows))',
    ].join('; ');
    try {
      const { stdout } = await runFile(pythonCommand(), ['-c', inline], { cwd: root, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
      const rows = JSON.parse(stdout.trim());
      if (Array.isArray(rows) && rows.length > 0) liveFetched += 1;
    } catch (err) {
      liveErrors.push(`${playerId}:${season} ${errorMessage(err)}`);
    }
  }

  const result: NbaIngestResult = {
    ok: computed > 0 || liveFetched > 0,
    profilesFound: files.length,
    computed,
    liveFetched,
    players,
    liveErrors,
  };
  await writeJsonState('sports-nba-ingest', { ...result, fetchedAt: nowIso() });
  return result;
}

// ============================================================================
// Bankroll pulse (Sports Steve → Draymond state)
// ============================================================================

export interface BankrollPulseResult {
  ok: boolean;
  bankroll?: unknown;
  bets?: unknown;
  error?: string;
}

/** Pull Sports Steve bankroll + bets and persist to .draymond/sports-bankroll.json. */
export async function bankrollPulse(): Promise<BankrollPulseResult> {
  const base = steveUrl();
  try {
    const [bankrollRes, betsRes] = await Promise.all([
      fetch(`${base}/bankroll`, { signal: AbortSignal.timeout(10_000) }),
      fetch(`${base}/bets`, { signal: AbortSignal.timeout(10_000) }),
    ]);
    const bankroll = bankrollRes.ok ? await bankrollRes.json() : { error: `HTTP ${bankrollRes.status}` };
    const bets = betsRes.ok ? await betsRes.json() : { error: `HTTP ${betsRes.status}` };
    await writeJsonState('sports-bankroll', { bankroll, bets, fetchedAt: nowIso() });
    return { ok: true, bankroll, bets };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
