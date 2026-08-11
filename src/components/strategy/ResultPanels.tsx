import type { ReactNode } from 'react';

export interface Proposal {
  id: string;
  name: string;
  description: string;
  sector: string;
  revenue_lane: string;
  revenue_note: string;
  risk_level: string;
  primary_asset: string;
  steps: unknown[];
  new_purpose_score: number;
  intel_findings: string[];
}

export interface Finding {
  id: string;
  kind: string;
  title: string;
  summary: string;
  score: number;
  sector?: string;
  assets?: string[];
}

export interface Cluster {
  id: string;
  label: string;
  itemIds: string[];
  score: number;
  severity: string;
  type: string;
  brandAlignment: string;
}

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-500/20 text-green-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  high: 'bg-orange-500/20 text-orange-400',
  critical: 'bg-red-500/20 text-red-400',
};

const KIND_COLORS: Record<string, string> = {
  pain_point: 'bg-red-500/20 text-red-400',
  trend: 'bg-blue-500/20 text-blue-400',
  anomaly: 'bg-orange-500/20 text-orange-400',
  insight: 'bg-purple-500/20 text-purple-400',
  hidden_insight: 'bg-cyan-500/20 text-cyan-400',
};

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-gray-900/60 p-5">
      <h3 className="text-base font-semibold text-white mb-3">{title}</h3>
      {children}
    </section>
  );
}

function ScoreBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-24 rounded-full bg-gray-800 overflow-hidden">
      <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function IntelPanel({ brief }: { brief: { findings: Finding[]; flags: string[] } }) {
  const findings = brief.findings ?? [];
  const flags = brief.flags ?? [];
  return (
    <Panel title={`Intel Brief (${findings.length} findings)`}>
      {findings.length === 0 && <p className="text-sm text-gray-500">No findings.</p>}
      <ul className="space-y-3">
        {findings.map((f) => (
          <li key={f.id} className="rounded-lg border border-white/[0.06] bg-gray-900/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${KIND_COLORS[f.kind] ?? 'bg-gray-500/20 text-gray-400'}`}>
                    {f.kind.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm font-semibold text-white truncate">{f.title}</span>
                </div>
                <p className="mt-1 text-xs text-gray-400">{f.summary}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ScoreBar value={f.score} />
                <span className="text-xs font-mono text-gray-300 w-8 text-right">{f.score}</span>
              </div>
            </div>
            {(() => {
              const assets = f.assets ?? [];
              return assets.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {assets.map((a) => (
                    <span key={a} className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">{a}</span>
                  ))}
                </div>
              );
            })()}
          </li>
        ))}
      </ul>
      {flags.length > 0 && (
        <div className="mt-3 space-y-1">
          {flags.map((fl, i) => (
            <p key={i} className="text-xs text-yellow-400/80">⚠ {fl}</p>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function ProposalsPanel({ proposals, autoCount, reviewCount }: { proposals: Proposal[]; autoCount?: number; reviewCount?: number }) {
  const items = proposals ?? [];
  return (
    <Panel title={`Venture Proposals (${items.length})`}>
      {items.length === 0 && <p className="text-sm text-gray-500">No proposals composed.</p>}
      <div className="mb-3 flex gap-2 text-xs">
        <span className="rounded-full bg-green-500/15 text-green-400 px-2.5 py-0.5">auto: {autoCount ?? 0}</span>
        <span className="rounded-full bg-yellow-500/15 text-yellow-400 px-2.5 py-0.5">review: {reviewCount ?? 0}</span>
      </div>
      <ul className="space-y-3">
        {items.map((p) => (
          <li key={p.id} className="rounded-lg border border-white/[0.06] bg-gray-900/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <span className="text-sm font-semibold text-white">{p.name}</span>
                <span className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${RISK_COLORS[p.risk_level] ?? 'bg-gray-500/20 text-gray-400'}`}>
                  {p.risk_level}
                </span>
              </div>
              <span className="text-xs font-mono text-gray-400 shrink-0">score {p.new_purpose_score}</span>
            </div>
            <p className="mt-1 text-xs text-gray-400">{p.description}</p>
            <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-gray-400">
              <span className="rounded bg-gray-800 px-1.5 py-0.5">{p.sector}</span>
              <span className="rounded bg-gray-800 px-1.5 py-0.5">{p.revenue_lane}</span>
              <span className="rounded bg-gray-800 px-1.5 py-0.5">asset: {p.primary_asset}</span>
              <span className="rounded bg-gray-800 px-1.5 py-0.5">{(p.steps ?? []).length} steps</span>
            </div>
            {p.revenue_note && <p className="mt-2 text-xs text-gray-500">{p.revenue_note}</p>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function StrategistPanel({ report }: { report: { clusters: Cluster[]; recommendations: string[]; flags: string[]; coverage: { totalItemsProcessed: number } } }) {
  const clusters = report.clusters ?? [];
  const recommendations = report.recommendations ?? [];
  const flags = report.flags ?? [];
  return (
    <Panel title={`Strategist Report (${report.coverage?.totalItemsProcessed ?? 0} items)`}>
      <ul className="space-y-3">
        {clusters.map((c) => (
          <li key={c.id} className="rounded-lg border border-white/[0.06] bg-gray-900/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">{c.label}</span>
              <span className="text-xs font-mono text-gray-300">score {c.score}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-gray-400">
              <span className="rounded bg-gray-800 px-1.5 py-0.5">{c.severity}</span>
              <span className="rounded bg-gray-800 px-1.5 py-0.5">{c.type}</span>
              <span className="rounded bg-gray-800 px-1.5 py-0.5">{c.brandAlignment}</span>
              <span className="rounded bg-gray-800 px-1.5 py-0.5">{c.itemIds.length} items</span>
            </div>
          </li>
        ))}
      </ul>
      {recommendations.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs uppercase tracking-wider text-gray-500 mb-1">Recommendations</h4>
          <ul className="space-y-1">
            {recommendations.map((r, i) => (
              <li key={i} className="text-xs text-gray-300">• {r}</li>
            ))}
          </ul>
        </div>
      )}
      {flags.length > 0 && (
        <div className="mt-3 space-y-1">
          {flags.map((fl, i) => (
            <p key={i} className="text-xs text-yellow-400/80">⚠ {fl}</p>
          ))}
        </div>
      )}
    </Panel>
  );
}
