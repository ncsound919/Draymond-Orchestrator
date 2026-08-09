import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

import {
  searchBooks,
  groundWithBooks,
  scanBookLibrary,
  citation,
  readingPlan,
  libraryHealthUrl,
} from '../src/lib/bookbridge';

afterEach(() => {
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function okJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('bookbridge client', () => {
  it('searches the library with hybrid mode and context chunks', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        results: [{ chunk_id: 'c1', book_id: 'b1', text: 'passage', book_title: 'The Framework', score: 0.8 }],
        total_matches: 1,
        query_ms: 3,
      }),
    );

    const results = await searchBooks('mental models', 3, 0.5);
    expect(results).toHaveLength(1);
    expect(results[0].book_title).toBe('The Framework');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:8777/search');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.query).toBe('mental models');
    expect(body.max_results).toBe(3);
    expect(body.min_score).toBe(0.5);
    expect(body.search_mode).toBe('hybrid');
    expect(body.include_context_chunks).toBe(true);
  });

  it('grounds a task with passages, mapping results into {book, passage, score}', async () => {
    fetchMock.mockResolvedValue(okJson({ results: [] }));
    // first fetch is the /health probe
    fetchMock.mockResolvedValueOnce(okJson({ status: 'ok' }));

    // Re-stub: first call = health, second call = search
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(okJson({ status: 'ok', books_indexed: 10 }))
      .mockResolvedValueOnce(
        okJson({
          results: [
            { chunk_id: 'c1', book_id: 'b1', text: 'passage one', book_title: 'Book A', score: 0.9 },
            { chunk_id: 'c2', book_id: 'b2', text: 'passage two', book_title: 'Book B', score: 0.4 },
          ],
          total_matches: 2,
          query_ms: 2,
        }),
      );

    const grounded = await groundWithBooks('strategy frameworks for growth teams');
    expect(grounded.grounded).toBe(true);
    expect(grounded.passages).toHaveLength(2);
    expect(grounded.passages[0]).toEqual({ book: 'Book A', passage: 'passage one', score: 0.9 });
  });

  it('returns grounded=false with a warning when the library is offline', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const grounded = await groundWithBooks('strategy frameworks for growth teams');
    expect(grounded.grounded).toBe(false);
    expect(grounded.warning).toMatch(/offline|unavailable/i);
  });

  it('returns grounded=false for too-short topics without calling fetch', async () => {
    const grounded = await groundWithBooks('short');
    expect(grounded.grounded).toBe(false);
    expect(grounded.warning).toContain('too short');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns grounded=false with warning when no passages match', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(okJson({ status: 'ok' })).mockResolvedValueOnce(okJson({ results: [], total_matches: 0, query_ms: 1 }));

    const grounded = await groundWithBooks('a sufficiently long research topic');
    expect(grounded.grounded).toBe(false);
    expect(grounded.warning).toContain('no relevant passages');
  });

  it('triggers a library scan', async () => {
    fetchMock.mockResolvedValue(okJson({ added_count: 3, skipped: 2 }));
    const result = await scanBookLibrary();
    expect(result).toEqual({ added_count: 3, skipped: 2 });
    const [, init] = fetchMock.mock.calls[0];
    expect(String(init.method)).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ force: false });
  });

  it('formats a citation', async () => {
    fetchMock.mockResolvedValue(okJson({ citation: 'Author (2024). Title.', bibtex_key: 'key' }));
    const c = await citation('b1', 'APA');
    expect(c).toBe('Author (2024). Title.');
  });

  it('generates a reading plan for a topic', async () => {
    fetchMock.mockResolvedValue(okJson({ plan: [{ step: 1 }], topic: 't' }));
    const plan = await readingPlan('growth strategy');
    expect(plan).toMatchObject({ topic: 't' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.max_books).toBe(5);
  });

  it('exposes the health URL from the configured base', () => {
    expect(libraryHealthUrl()).toBe('http://127.0.0.1:8777/health');
  });
});
