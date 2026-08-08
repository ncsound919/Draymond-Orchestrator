/**
 * Sports Steve editorial builder — Draymond's agentic teams produce the
 * morning betting articles and push them to the Sports Steve backend.
 */
import { fetchOdds } from './sports-steve-odds';

const STEVE_URL = process.env.SPORTS_STEVE_URL ?? 'http://localhost:8010';

export interface EditorialArticle {
  title: string;
  body: string;
  landscape: string;
  tags: string[];
  is_featured: boolean;
  source: 'draymond';
  published_at: string;
}

export async function buildEditorialArticles(): Promise<EditorialArticle[]> {
  const odds = await fetchOdds();
  const articles: EditorialArticle[] = [];
  if (odds.length === 0) return articles;
  for (const game of odds.slice(0, 6)) {
    const matchup = `${game.home_team} vs ${game.away_team}`;
    articles.push({
      title: matchup,
      body: `${matchup} — check current spread and totals before tip-off.`,
      landscape: `Monitor the spread; shop three books; re-check availability before tip.`,
      tags: ['editorial', 'odds'],
      is_featured: articles.length === 0,
      source: 'draymond',
      published_at: new Date().toISOString(),
    });
  }
  return articles;
}

export async function pushEditorialToSteve(articles: EditorialArticle[]): Promise<{ imported: number }> {
  if (articles.length === 0) return { imported: 0 };
  const res = await fetch(`${STEVE_URL}/api/v1/editorial/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articles }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`editorial ingest failed: HTTP ${res.status}`);
  const data = (await res.json()) as { imported: number };
  return data;
}
