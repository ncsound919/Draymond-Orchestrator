'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useQueryState, parseAsString } from 'nuqs';

type SearchResult = {
  id: string;
  type: 'post' | 'listing' | 'news';
  title: string;
  snippet: string;
  href: string;
  similarity?: number;
};

export default function SearchClient({ initialQuery }: { initialQuery: string }) {
  const [urlQuery, setUrlQuery] = useQueryState('q', parseAsString.withDefault(''));
  const query = urlQuery || initialQuery;
  const [inputValue, setInputValue] = useState(query);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setSearched(true);

    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(trimmed)}&limit=20`,
        { signal: controller.signal }
      );
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      if (!controller.signal.aborted) {
        setResults(data.results ?? []);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!controller.signal.aborted) {
        setResults([]);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  // Search on mount if there's an initial query
  useEffect(() => {
    if (query) {
      setInputValue(query);
      doSearch(query);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inputValue.trim();
    await setUrlQuery(trimmed || null);
    doSearch(trimmed);
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="flex gap-3">
          <input
            name="q"
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search posts, listings, news..."
            className="flex-1 px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#22c55e]"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-[#22c55e] text-[#0a0a0a] font-semibold rounded-xl hover:bg-[#4ade80] transition-colors disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {loading && (
        <div className="text-center py-12">
          <div className="inline-block w-8 h-8 border-2 border-[#22c55e] border-t-transparent rounded-full animate-spin" />
          <p className="mt-3 text-white/40 text-sm">Searching...</p>
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-12">
          <p className="text-white/40">No results found for &ldquo;{query}&rdquo;</p>
          <p className="text-white/30 text-sm mt-1">Try different keywords or broader terms.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-white/40 mb-4">
            {results.length} result{results.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
          </p>
          {results.map((r) => (
            <Link
              key={`${r.type}-${r.id}`}
              href={r.href}
              className="block glass-card p-5 hover:border-[#22c55e]/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="shrink-0 px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-white/60 uppercase">
                  {r.type}
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold text-white truncate">{r.title}</h3>
                  <p className="text-sm text-white/40 mt-1 line-clamp-2">{r.snippet}</p>
                  {r.similarity != null && (
                    <p className="text-xs text-white/20 mt-1">
                      Relevance: {Math.round(r.similarity * 100)}%
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && !searched && (
        <div className="text-center py-16">
          <p className="text-white/30 text-lg">Search across posts, listings, and news articles.</p>
          <p className="text-white/20 text-sm mt-2">
            Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/40 border border-white/10 font-mono text-xs">/</kbd> to focus search from anywhere.
          </p>
        </div>
      )}
    </div>
  );
}
