/**
 * News ingestion — current information + happenings across the fleet.
 *
 * Pulls from the configured news APIs (NEWSAPI_KEY, GNEWS_API_KEY,
 * WORLDNEWS_API_KEY), normalizes into one shape, tags by Overlay365 engine
 * relevance, and stores for the daily digest + agent context.
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface NewsItem {
  id: string;
  source: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
  /** Relevance tags: E1-platform | E2-b2b | E3-tooling | E4-vertical | health | wealth | justice | business | ai */
  tags: string[];
}

const DIR = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
const FILE = path.join(DIR, "news-cache.json");

const RELEVANCE_KEYWORDS: Record<string, string[]> = {
  health: ["health", "wellness", "fitness", "medical", "telehealth", "clinician", "nutrition"],
  wealth: ["invest", "stock", "portfolio", "finance", "crypto", "wealth", "market", "economy"],
  justice: ["legal", "law", "compliance", "regulation", "court", "justice", "policy"],
  business: ["saas", "startup", "business", "smb", "small business", "entrepreneur", "b2b"],
  ai: ["ai", "artificial intelligence", "llm", "agent", "automation", "machine learning"],
  callcenter: ["call center", "customer service", "support", "contact center", "cx"],
};

function tagTitle(text: string): string[] {
  const tags: string[] = [];
  const lower = text.toLowerCase();
  for (const [tag, kws] of Object.entries(RELEVANCE_KEYWORDS)) {
    if (kws.some((k) => lower.includes(k))) tags.push(tag);
  }
  return tags;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `n_${Math.abs(h).toString(36)}`;
}

async function readCache(): Promise<NewsItem[]> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw) as { items?: NewsItem[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function writeCache(items: NewsItem[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ items, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Ingest from all configured news APIs. Returns items fetched + errors. */
export async function ingestNews(): Promise<{ items: NewsItem[]; errors: string[] }> {
  const items: NewsItem[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString().slice(0, 10);

  const newsKey = process.env.NEWSAPI_KEY;
  if (newsKey) {
    try {
      const q = "business OR ai OR technology OR health";
      const data = (await fetchJson(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&from=${now}&language=en&pageSize=20&apiKey=${newsKey}`
      )) as { articles?: Array<{ title: string; url: string; description?: string; publishedAt: string }> };
      for (const a of data.articles ?? []) {
        if (!a.title) continue;
        items.push({
          id: hash(`newsapi:${a.url}`), source: "newsapi", title: a.title, url: a.url,
          summary: a.description ?? "", publishedAt: a.publishedAt, tags: tagTitle(a.title),
        });
      }
    } catch (err) {
      errors.push(`newsapi: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    errors.push("newsapi: NEWSAPI_KEY not configured");
  }

  const gnewsKey = process.env.GNEWS_API_KEY;
  if (gnewsKey) {
    try {
      const data = (await fetchJson(
        `https://gnews.io/api/v4/top-headlines?category=business&lang=en&max=20&apikey=${gnewsKey}`
      )) as { articles?: Array<{ title: string; url: string; description?: string; publishedAt: string }> };
      for (const a of data.articles ?? []) {
        if (!a.title) continue;
        items.push({
          id: hash(`gnews:${a.url}`), source: "gnews", title: a.title, url: a.url,
          summary: a.description ?? "", publishedAt: a.publishedAt, tags: tagTitle(a.title),
        });
      }
    } catch (err) {
      errors.push(`gnews: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    errors.push("gnews: GNEWS_API_KEY not configured");
  }

  const worldKey = process.env.WORLDNEWS_API_KEY;
  if (worldKey) {
    try {
      const data = (await fetchJson(
        `https://api.worldnewsapi.com/search-news?text=business+OR+ai&max-results=20&api-key=${worldKey}`
      )) as { news?: Array<{ title: string; url: string; text?: string; publish_date: string }> };
      for (const a of data.news ?? []) {
        if (!a.title) continue;
        items.push({
          id: hash(`worldnews:${a.url}`), source: "worldnews", title: a.title, url: a.url,
          summary: a.text?.slice(0, 200) ?? "", publishedAt: a.publish_date, tags: tagTitle(a.title),
        });
      }
    } catch (err) {
      errors.push(`worldnews: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    errors.push("worldnews: WORLDNEWS_API_KEY not configured");
  }

  const cache = await readCache();
  const seen = new Set(cache.map((c) => c.id));
  const fresh = items.filter((i) => !seen.has(i.id));
  await writeCache([...fresh, ...cache].slice(0, 500));
  return { items: fresh, errors };
}

export async function newsDigest(tag?: string): Promise<{ items: NewsItem[]; updatedAt: string }> {
  const items = await readCache();
  const filtered = tag ? items.filter((i) => i.tags.includes(tag)) : items;
  return { items: filtered.slice(0, 50), updatedAt: new Date().toISOString() };
}

export function renderNewsDigest(items: NewsItem[]): string {
  const lines = items.map((i, idx) => `[${idx + 1}] ${i.title}\n    ${i.url}\n    tags: ${i.tags.join(", ") || "none"}`);
  return lines.length ? lines.join("\n") : "_No news ingested yet._";
}
