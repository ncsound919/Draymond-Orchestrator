/**
 * Minimal Odds API client for the editorial builder. Pulls live events for a
 * sport and normalizes them (home/away, movement flags). No key = empty list.
 */
const ODDS_API_KEY = process.env.THE_ODDS_API_KEY ?? '';

export interface OddsEvent {
  id: string;
  home_team: string;
  away_team: string;
  commence_time: string;
  spread_movement: string | null;
  totals_movement: string | null;
}

export async function fetchOdds(sportKey = 'basketball_nba'): Promise<OddsEvent[]> {
  if (!ODDS_API_KEY) return [];
  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return [];
    const raw = (await res.json()) as Array<Record<string, unknown>>;
    return raw.map((e) => ({
      id: String(e.id ?? ''),
      home_team: String(e.home_team ?? ''),
      away_team: String(e.away_team ?? ''),
      commence_time: String(e.commence_time ?? ''),
      spread_movement: null,
      totals_movement: null,
    }));
  } catch {
    return [];
  }
}
