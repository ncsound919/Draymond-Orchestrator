/**
 * useMathMemory — IndexedDB TF-IDF memory store for the Math Lab.
 * Ported from @mathx/web (state/memory.ts). Falls back to an in-memory cache
 * when IndexedDB is unavailable.
 */
'use client';

import { get, set } from 'idb-keyval';

const MEM_KEY = 'mathx-memory-v1';
const MAX_ENTRIES = 200;

interface MemoryEntry {
  id: string;
  query: string;
  response: string;
  tokens: string[];
  timestamp: number;
}

let cache: MemoryEntry[] | null = null;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function tfidfScore(queryTokens: string[], entry: MemoryEntry): number {
  const qSet = new Set(queryTokens);
  const matches = entry.tokens.filter((t) => qSet.has(t)).length;
  return matches / Math.max(entry.tokens.length, queryTokens.length, 1);
}

async function getCache(): Promise<MemoryEntry[]> {
  if (cache !== null) return cache;
  try {
    const stored = await get<MemoryEntry[]>(MEM_KEY);
    cache = stored || [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persistCache(): Promise<void> {
  try {
    await set(MEM_KEY, cache);
  } catch {
    /* IndexedDB unavailable — keep in-memory only */
  }
}

export function useMathMemory() {
  const search = async (query: string, topK = 5): Promise<Array<{ source: string; text: string; score: number }>> => {
    const entries = await getCache();
    if (entries.length === 0) return [];
    const qTokens = tokenize(query);
    return entries
      .map((e) => ({ source: e.id, text: e.response.slice(0, 400), score: tfidfScore(qTokens, e) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  };

  const store = async (query: string, response: string) => {
    const entries = await getCache();
    const entry: MemoryEntry = {
      id: `mem-${Date.now()}`,
      query,
      response,
      tokens: tokenize(`${query} ${response}`),
      timestamp: Date.now(),
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    cache = entries;
    await persistCache();
  };

  return { search, store };
}
