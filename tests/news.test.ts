import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-news-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

// news.ts captures DIR at module load (news.ts:23), so the module is
// re-imported per test after DRAYMOND_REGISTRY_DIR is pointed at tmp.
let news: typeof import('../src/lib/draymond/news');
let fetchMock: Mock;

const jsonResponse = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const NEWSAPI_URL = 'https://newsapi.org/v2/everything';
const GNEWS_URL = 'https://gnews.io/api/v4/top-headlines';
const WORLD_URL = 'https://api.worldnewsapi.com/search-news';

beforeEach(async () => {
  vi.resetModules();
  news = await import('../src/lib/draymond/news');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  fs.rmSync(path.join(tmp, 'news-cache.json'), { force: true });
  delete process.env.NEWSAPI_KEY;
  delete process.env.GNEWS_API_KEY;
  delete process.env.WORLDNEWS_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('news ingest', () => {
  it('ingests newsapi articles, tags titles by keyword, and skips title-less entries', async () => {
    process.env.NEWSAPI_KEY = 'news-key-1';
    const today = new Date().toISOString().slice(0, 10);
    fetchMock.mockResolvedValue(
      jsonResponse({
        articles: [
          { title: 'AI agents transform customer support', url: 'https://example.com/1', description: 'd1', publishedAt: '2026-08-09T10:00:00Z' },
          { title: 'Markets rally on new AI chips', url: 'https://example.com/2', publishedAt: '2026-08-09T11:00:00Z' },
          { title: '', url: 'https://example.com/skip', description: 'no title', publishedAt: '2026-08-09T12:00:00Z' },
          { url: 'https://example.com/no-title', publishedAt: '2026-08-09T13:00:00Z' },
        ],
      }),
    );
    const r = await news.ingestNews();
    expect(r.items).toHaveLength(2);
    expect(r.items.map((i) => i.source)).toEqual(['newsapi', 'newsapi']);
    expect(r.items[0]).toMatchObject({
      source: 'newsapi',
      title: 'AI agents transform customer support',
      url: 'https://example.com/1',
      summary: 'd1',
      publishedAt: '2026-08-09T10:00:00Z',
    });
    expect(r.items[0].id).toMatch(/^n_[a-z0-9]+$/);
    expect(r.items[0].tags).toEqual(expect.arrayContaining(['ai']));
    expect(r.items[0].tags).toEqual(expect.arrayContaining(['callcenter']));
    expect(r.items[1].tags).toEqual(expect.arrayContaining(['wealth']));
    expect(r.items[1].tags).toEqual(expect.arrayContaining(['ai']));
    expect(r.errors).toEqual([
      'gnews: GNEWS_API_KEY not configured',
      'worldnews: WORLDNEWS_API_KEY not configured',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `${NEWSAPI_URL}?q=business%20OR%20ai%20OR%20technology%20OR%20health&from=${today}&language=en&pageSize=20&apiKey=news-key-1`,
    );
    expect(init).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it('ingests gnews and worldnews shapes, slicing worldnews text summaries', async () => {
    process.env.GNEWS_API_KEY = 'g-key';
    process.env.WORLDNEWS_API_KEY = 'w-key';
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('gnews.io')) {
        return jsonResponse({
          articles: [{ title: 'SaaS startup secures new capital', url: 'https://g/1', description: 'funding', publishedAt: '2026-08-09T00:00:00Z' }],
        });
      }
      return jsonResponse({
        news: [{ title: 'Telehealth provider expands', url: 'https://w/1', text: 'a'.repeat(250), publish_date: '2026-08-08' }],
      });
    });
    const r = await news.ingestNews();
    expect(r.items).toHaveLength(2);
    const g = r.items.find((i) => i.source === 'gnews')!;
    expect(g).toMatchObject({ title: 'SaaS startup secures new capital', summary: 'funding', tags: ['business'] });
    const w = r.items.find((i) => i.source === 'worldnews')!;
    expect(w.summary).toHaveLength(200);
    expect(w.summary).toBe('a'.repeat(200));
    expect(w.tags).toEqual(expect.arrayContaining(['health']));
    expect(r.errors).toEqual(['newsapi: NEWSAPI_KEY not configured']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${GNEWS_URL}?category=business&lang=en&max=20&apikey=g-key`);
    expect(String(fetchMock.mock.calls[1][0])).toBe(`${WORLD_URL}?text=business+OR+ai&max-results=20&api-key=w-key`);
  });

  it('returns graceful per-source errors and writes an empty cache when no keys are set', async () => {
    const r = await news.ingestNews();
    expect(r.items).toEqual([]);
    expect(r.errors).toEqual([
      'newsapi: NEWSAPI_KEY not configured',
      'gnews: GNEWS_API_KEY not configured',
      'worldnews: WORLDNEWS_API_KEY not configured',
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    const cache = JSON.parse(fs.readFileSync(path.join(tmp, 'news-cache.json'), 'utf-8'));
    expect(cache.items).toEqual([]);
    expect(typeof cache.updatedAt).toBe('string');
  });

  it('reports fetch failures per source without crashing', async () => {
    process.env.NEWSAPI_KEY = 'k1';
    process.env.GNEWS_API_KEY = 'k2';
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockRejectedValueOnce(new Error('network down'));
    const r = await news.ingestNews();
    expect(r.items).toEqual([]);
    expect(r.errors).toEqual([
      'newsapi: HTTP 429',
      'gnews: network down',
      'worldnews: WORLDNEWS_API_KEY not configured',
    ]);
  });

  it('treats a successful fetch with an unexpected payload as zero articles', async () => {
    process.env.NEWSAPI_KEY = 'k1';
    fetchMock.mockResolvedValue(jsonResponse({ status: 'error' }));
    const r = await news.ingestNews();
    expect(r.items).toEqual([]);
    expect(r.errors).toEqual([
      'gnews: GNEWS_API_KEY not configured',
      'worldnews: WORLDNEWS_API_KEY not configured',
    ]);
  });

  it('dedupes already-cached items and caps the cache at 500 entries', async () => {
    process.env.NEWSAPI_KEY = 'k1';
    const article = { title: 'AI boom', url: 'https://example.com/ai-boom', description: 'x', publishedAt: '2026-08-09T00:00:00Z' };
    fetchMock.mockResolvedValue(jsonResponse({ articles: [article] }));
    const first = await news.ingestNews();
    expect(first.items).toHaveLength(1);
    const second = await news.ingestNews();
    expect(second.items).toEqual([]); // same id → deduped against the cache

    const seed = Array.from({ length: 500 }, (_, i) => ({
      id: `n_seed_${i}`, source: 'newsapi', title: `seed ${i}`, url: `https://seed.example/${i}`,
      summary: '', publishedAt: '2026-08-01', tags: [],
    }));
    fs.writeFileSync(path.join(tmp, 'news-cache.json'), JSON.stringify({ items: seed, updatedAt: 'x' }));
    const fresh = await news.ingestNews();
    expect(fresh.items).toHaveLength(1);
    const cache = JSON.parse(fs.readFileSync(path.join(tmp, 'news-cache.json'), 'utf-8'));
    expect(cache.items).toHaveLength(500);
    expect(cache.items[0].url).toBe('https://example.com/ai-boom'); // newest first
    expect(cache.items.some((i: { id: string }) => i.id === 'n_seed_499')).toBe(false); // oldest dropped
  });
});

describe('news cache + digest', () => {
  it('newsDigest reads the cache, filters by tag, caps at 50, and stamps updatedAt', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      id: `n_d${i}`, source: 'newsapi', title: `item ${i}`, url: `https://d/${i}`,
      summary: '', publishedAt: '2026-08-01', tags: i % 2 === 0 ? ['ai'] : ['health'],
    }));
    fs.writeFileSync(path.join(tmp, 'news-cache.json'), JSON.stringify({ items, updatedAt: 'x' }));
    const all = await news.newsDigest();
    expect(all.items).toHaveLength(50);
    expect(all.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const ai = await news.newsDigest('ai');
    expect(ai.items).toHaveLength(30);
    expect(ai.items.every((i) => i.tags.includes('ai'))).toBe(true);
    const health = await news.newsDigest('health');
    expect(health.items).toHaveLength(30);
    expect(health.items.every((i) => i.tags.includes('health'))).toBe(true);
  });

  it('newsDigest tolerates a missing or corrupt cache file', async () => {
    expect(await news.newsDigest()).toEqual({ items: [], updatedAt: expect.any(String) });
    fs.writeFileSync(path.join(tmp, 'news-cache.json'), '{not json');
    expect(await news.newsDigest()).toEqual({ items: [], updatedAt: expect.any(String) });
  });

  it('renderNewsDigest formats items and falls back when empty', () => {
    const items = [
      { id: 'n_1', source: 'newsapi', title: 'First', url: 'https://a/1', summary: '', publishedAt: '2026-08-01', tags: ['ai', 'business'] },
      { id: 'n_2', source: 'newsapi', title: 'Second', url: 'https://a/2', summary: '', publishedAt: '2026-08-01', tags: [] },
    ];
    const out = news.renderNewsDigest(items);
    expect(out).toContain('[1] First');
    expect(out).toContain('    https://a/1');
    expect(out).toContain('tags: ai, business');
    expect(out).toContain('[2] Second');
    expect(out).toContain('    https://a/2');
    expect(out).toContain('tags: none');
    expect(news.renderNewsDigest([])).toBe('_No news ingested yet._');
  });
});
