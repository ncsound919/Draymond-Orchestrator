/**
 * BioPanel — live NCBI + UniProt lookup for the Math Lab. Pure server-proxied
 * queries (no LLM); results can be injected as retrieved context.
 */
'use client';

import { useState } from 'react';

interface Row {
  uid?: string;
  accession?: string;
  title?: string;
  proteinName?: string;
  geneNames?: string[];
  description?: string;
  organism?: string;
  length?: number | null;
  id?: string;
  url?: string;
}

interface BioPanelProps {
  onSelect: (rows: Array<{ source: string; text: string; score: number }>) => void;
  accent: string;
}

const NCBI_DBS = ['protein', 'nucleotide', 'gene', 'pubmed'];

export function BioPanel({ onSelect, accent }: BioPanelProps) {
  const [tab, setTab] = useState<'ncbi' | 'uniprot'>('uniprot');
  const [query, setQuery] = useState('');
  const [db, setDb] = useState('protein');
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      const url = tab === 'ncbi' ? '/api/math/bio/ncbi' : '/api/math/bio/uniprot';
      const body = tab === 'ncbi' ? { query: q, db, retmax: 5 } : { query: q, size: 5 };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { results?: Row[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Search failed');
      setRows(data.results ?? []);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const injectSelected = () => {
    onSelect(
      rows
        .filter((r) => selected.has(r.accession ?? r.uid ?? String(r.title)))
        .map((r) => ({
          source: r.accession ?? r.uid ?? 'bio',
          text: `[${tab}] ${r.proteinName ?? r.title ?? ''} | organism: ${r.organism ?? ''} | ${r.description ?? ''} | ${r.url ?? ''}`.slice(0, 600),
          score: 1,
        })),
    );
    setSelected(new Set());
  };

  const keyOf = (r: Row) => r.accession ?? r.uid ?? String(r.title);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ fontSize: '0.62rem', letterSpacing: '0.12em', color: accent, marginBottom: 8 }}>
        BIO LOOKUP · NCBI + UniProt
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {(['uniprot', 'ncbi'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setRows([]); setSelected(new Set()); }}
            style={{
              padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: '0.68rem',
              background: tab === t ? accent + '22' : 'transparent',
              border: tab === t ? `1px solid ${accent}66` : '1px solid var(--border)',
              color: tab === t ? accent : 'var(--text-muted)',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {tab === 'ncbi' && (
          <select
            value={db}
            onChange={(e) => setDb(e.target.value)}
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 5, fontSize: '0.72rem', padding: '0 6px' }}
          >
            {NCBI_DBS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
          placeholder="protein / gene / organism…"
          style={{
            flex: 1, background: 'var(--bg2)', border: '1px solid var(--border)',
            color: 'var(--text)', borderRadius: 5, padding: '7px 10px', fontSize: '0.75rem', outline: 'none',
          }}
        />
        <button
          onClick={() => void search()}
          disabled={loading}
          style={{ background: accent, border: 'none', borderRadius: 5, color: '#0a0a0a', padding: '0 12px', cursor: 'pointer', fontWeight: 700, fontSize: '0.72rem' }}
        >
          {loading ? '…' : 'GO'}
        </button>
      </div>
      {error && <div style={{ marginTop: 6, fontSize: '0.68rem', color: '#e8b4b4' }}>{error}</div>}
      <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8 }}>
        {rows.map((r) => (
          <div
            key={keyOf(r)}
            onClick={() => toggle(keyOf(r))}
            style={{
              padding: 8, borderRadius: 6, marginBottom: 6, cursor: 'pointer',
              background: selected.has(keyOf(r)) ? `${accent}18` : 'var(--bg3)',
              border: `1px solid ${selected.has(keyOf(r)) ? accent + '66' : 'var(--border-dim)'}`,
            }}
          >
            <div style={{ fontSize: '0.74rem', color: 'var(--text)' }}>{r.proteinName ?? r.title ?? r.accession ?? ''}</div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {r.accession ?? r.uid ?? ''} · {r.organism ?? ''} {r.length ? `· ${r.length} aa` : ''} · {(r.geneNames ?? []).join(', ')}
            </div>
          </div>
        ))}
        {rows.length === 0 && !loading && query && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>No results.</div>}
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
