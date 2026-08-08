/**
 * LiteraturePanel — PubMed/arXiv search for the Math Lab. Selected papers are
 * injected as retrieved context into the next Math X chat turn.
 */
'use client';

import { useState } from 'react';

interface Paper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  year: string;
  journal: string;
  url: string;
  source: 'pubmed' | 'arxiv';
}

interface LiteraturePanelProps {
  onSelect: (papers: Array<{ source: string; text: string; score: number }>) => void;
  accent: string;
}

export function LiteraturePanel({ onSelect, accent }: LiteraturePanelProps) {
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState({ pubmed: true, arxiv: true });
  const [results, setResults] = useState<Paper[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const q = query.trim();
    if (q.length < 2 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const picked = Object.entries(sources)
        .filter(([, on]) => on)
        .map(([k]) => k as 'pubmed' | 'arxiv');
      const res = await fetch('/api/math/literature/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, sources: picked, maxPerSource: 4 }),
      });
      const data = (await res.json()) as { results?: Paper[]; errors?: string[] };
      if (!res.ok) throw new Error('Search failed');
      setResults(data.results ?? []);
      if (data.errors?.length) setError(data.errors.join('; '));
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const injectSelected = () => {
    const papers = results.filter((p) => selected.has(p.id));
    onSelect(
      papers.map((p) => ({
        source: p.id,
        text: `${p.title} (${p.year}, ${p.journal}). ${p.abstract}`.slice(0, 600),
        score: 1,
      })),
    );
    setSelected(new Set());
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: '0.62rem', letterSpacing: '0.12em', color: accent, marginBottom: 8 }}>
        LITERATURE RAG · PubMed + arXiv
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
          placeholder="search papers…"
          style={{
            flex: 1, background: 'var(--bg2)', border: '1px solid var(--border)',
            color: 'var(--text)', borderRadius: 5, padding: '7px 10px', fontSize: '0.75rem', outline: 'none',
          }}
        />
        <button
          onClick={() => void search()}
          disabled={loading}
          style={{ background: accent, border: 'none', borderRadius: 5, color: '#0a0a0a', padding: '0 14px', cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem' }}
        >
          {loading ? '…' : 'SEARCH'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
        {(['pubmed', 'arxiv'] as const).map((s) => (
          <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" name={`lit-source-${s}`} checked={sources[s]} onChange={(e) => setSources((p) => ({ ...p, [s]: e.target.checked }))} />
            {s}
          </label>
        ))}
      </div>
      {error && <div style={{ marginTop: 6, fontSize: '0.68rem', color: '#e8b4b4' }}>{error}</div>}
      <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}>
        {results.map((p) => (
          <div
            key={p.id}
            onClick={() => toggle(p.id)}
            style={{
              padding: 8, borderRadius: 6, marginBottom: 6, cursor: 'pointer',
              background: selected.has(p.id) ? `${accent}18` : 'var(--bg3)',
              border: `1px solid ${selected.has(p.id) ? accent + '66' : 'var(--border-dim)'}`,
            }}
          >
            <div style={{ fontSize: '0.74rem', color: 'var(--text)' }}>{p.title}</div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {p.authors.slice(0, 3).join(', ')} · {p.year} · {p.journal} · {p.source}
            </div>
          </div>
        ))}
        {results.length === 0 && !loading && query && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>No results.</div>}
      </div>
      <button
        onClick={injectSelected}
        disabled={selected.size === 0}
        style={{
          marginTop: 8, width: '100%', background: 'transparent', border: `1px solid ${accent}55`,
          color: accent, borderRadius: 5, padding: '7px 0', cursor: selected.size ? 'pointer' : 'default',
          fontWeight: 700, fontSize: '0.7rem', opacity: selected.size ? 1 : 0.4,
        }}
      >
        INJECT {selected.size || ''} INTO CONTEXT
      </button>
    </div>
  );
}
