'use client';

import { useState, useTransition } from 'react';
import { IntelPanel, ProposalsPanel, StrategistPanel, type Proposal, type Finding, type Cluster } from './ResultPanels';

type Mode = 'weeklyScan' | 'intel' | 'scout' | 'strategist';

interface ResultData {
  ok?: boolean;
  error?: string;
  brief?: { findings: Finding[]; flags: string[] };
  proposals?: Proposal[];
  autoCount?: number;
  reviewCount?: number;
  report?: { clusters: Cluster[]; recommendations: string[]; flags: string[]; coverage: { totalItemsProcessed: number } };
  markdown?: string;
}

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'weeklyScan', label: 'Weekly Venture Scan' },
  { id: 'intel', label: 'Intel Brief' },
  { id: 'scout', label: 'Venture Scout' },
  { id: 'strategist', label: 'Strategist Report' },
];

export function StrategyRunner() {
  const [mode, setMode] = useState<Mode>('weeklyScan');
  const [periodStart, setPeriodStart] = useState('2026-07-20T00:00:00Z');
  const [periodEnd, setPeriodEnd] = useState('2026-08-02T00:00:00Z');
  const [feedbackJson, setFeedbackJson] = useState('');
  const [hiddenJson, setHiddenJson] = useState('');
  const [useLiveRegistry, setUseLiveRegistry] = useState(true);
  const [result, setResult] = useState<ResultData | null>(null);
  const [isPending, startTransition] = useTransition();

  async function run() {
    if (isPending) return;
    setResult(null);

    const payload: Record<string, unknown> = { mode };

    if (periodStart) payload.periodStart = periodStart;
    if (periodEnd) payload.periodEnd = periodEnd;

    if (feedbackJson.trim()) {
      try { payload.feedback = JSON.parse(feedbackJson); } catch { setResult({ ok: false, error: 'Feedback JSON is invalid.' }); return; }
    }
    if (hiddenJson.trim()) {
      try { payload.hiddenInputs = JSON.parse(hiddenJson); } catch { setResult({ ok: false, error: 'Hidden insights JSON is invalid.' }); return; }
    }

    if (useLiveRegistry) {
      try {
        const [entitiesRes, chainsRes] = await Promise.all([
          fetch('/api/entities'),
          fetch('/api/chains?is_template=true'),
        ]);
        const entities = (await entitiesRes.json()).entities ?? [];
        const chains = (await chainsRes.json()).chains ?? [];
        payload.assets = entities.map((e: { slug: string; capabilities?: string[] }) => ({ slug: e.slug, capabilities: e.capabilities ?? [] }));
        payload.existingChains = chains.map((c: { slug?: string; name?: string }) => c.slug ?? c.name ?? '').filter(Boolean);
      } catch {
        // registry fetch failure is non-fatal; fall back to empty assets
      }
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/strategy/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        setResult(data);
      } catch {
        setResult({ ok: false, error: 'Strategy run request failed.' });
      }
    });
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-gray-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-blue-500/50';

  return (
    <div className="space-y-6">
      {/* Controls */}
      <section className="rounded-xl border border-white/[0.06] bg-gray-900/60 p-5">
        <h2 className="text-base font-semibold text-white mb-3">Run Strategy Agent</h2>

        <div className="mb-4 flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === m.id
                  ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                  : 'border-white/10 text-gray-400 hover:text-white'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">Period start</span>
            <input className={inputCls} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">Period end</span>
            <input className={inputCls} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs text-gray-400">Feedback items (EvidenceItem[] JSON, optional)</span>
          <textarea className={inputCls} rows={3} value={feedbackJson} onChange={(e) => setFeedbackJson(e.target.value)} placeholder='[{ "id":"ev1","source":"support-email","platform":"health","rawText":"...","timestamp":"2026-07-25T00:00:00Z","channel":"contact-form","metadata":{},"confidence":"high" }]' />
        </label>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs text-gray-400">Hidden insights (HiddenInsightInput[] JSON, optional)</span>
          <textarea className={inputCls} rows={3} value={hiddenJson} onChange={(e) => setHiddenJson(e.target.value)} placeholder='[{ "source":"openfda","terms":["reaction"],"assets":["uplift-agent"] }]' />
        </label>

        <label className="mt-4 flex items-center gap-2">
          <input type="checkbox" checked={useLiveRegistry} onChange={(e) => setUseLiveRegistry(e.target.checked)} className="h-4 w-4 accent-blue-500" />
          <span className="text-sm text-gray-300">Use live Draymond registry (entities + chains)</span>
        </label>

        <button
          onClick={run}
          disabled={isPending}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-500/15 border border-blue-500/30 px-4 py-2.5 text-sm font-medium text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? 'Running…' : 'Run'}
        </button>
      </section>

      {/* Results */}
      {result && !result.ok && (
        <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          {result.error ?? 'Strategy run failed.'}
        </div>
      )}

      {result?.ok && (
        <div aria-live="polite" className="space-y-6">
          {result.brief && <IntelPanel brief={result.brief} />}
          {result.proposals && <ProposalsPanel proposals={result.proposals} autoCount={result.autoCount} reviewCount={result.reviewCount} />}
          {result.report && <StrategistPanel report={result.report} />}
          {result.markdown && (
            <details className="rounded-xl border border-white/[0.06] bg-gray-900/60 p-5">
              <summary className="cursor-pointer text-sm font-semibold text-white">Markdown report</summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-gray-400">{result.markdown}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
