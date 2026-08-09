export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { readStrategy, unitEconomics } from '@/lib/draymond/mission-strategy';
import { missionDashboard } from '@/lib/draymond/mission-pipeline';
import { listOpportunities } from '@/lib/draymond/business-pipeline';
import { settledRevenueUsd } from '@/lib/draymond/treasury-state';

export const metadata: Metadata = {
  title: 'Mission Control | Draymond Orchestrator',
  description: 'Mission engine — revenue service lines, pipeline, settled cash vs target',
};

const STAGE_COLORS: Record<string, string> = {
  lead: 'bg-gray-500/20 text-gray-400',
  proposal: 'bg-blue-500/20 text-blue-400',
  negotiation: 'bg-purple-500/20 text-purple-400',
  won: 'bg-green-500/20 text-green-400',
  delivering: 'bg-amber-500/20 text-amber-400',
  invoiced: 'bg-cyan-500/20 text-cyan-400',
  paid: 'bg-emerald-500/20 text-emerald-400',
  lost: 'bg-red-500/20 text-red-400',
};

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function usd(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

export default async function MissionPage() {
  let strategy;
  let dash;
  let opportunities;
  let revenue;
  try {
    [strategy, dash, opportunities, revenue] = await Promise.all([
      readStrategy(),
      missionDashboard(),
      listOpportunities(),
      settledRevenueUsd(),
    ]);
  } catch (err) {
    console.error('[MissionPage] failed to load mission data:', err);
    return (
      <div className="min-h-screen text-white">
        <div className="max-w-6xl mx-auto px-4 py-24 text-center">
          <p className="text-5xl mb-4 opacity-40">&#x26A0;</p>
          <h1 className="text-xl font-bold mb-2">Failed to load mission data</h1>
          <p className="text-white/40 text-sm">Check the registry state and try again.</p>
        </div>
      </div>
    );
  }

  const target = strategy.services.reduce((s, x) => s + x.targetMonthly, 0);
  const onTarget = revenue >= target;

  return (
    <div className="min-h-screen">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold tracking-tight text-white">Mission Control</h1>
          <p className="mt-1 text-sm text-gray-400">
            Revenue service lines · pipeline automaton · settled cash vs target
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        {/* ── Revenue banner ───────────────────────────────────────────── */}
        <div
          className={`rounded-xl border bg-gradient-to-r p-5 ${
            onTarget
              ? 'from-green-500/20 to-green-900/10 border-green-500/30'
              : 'from-amber-500/20 to-amber-900/10 border-amber-500/30'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={`h-3 w-3 rounded-full animate-pulse ${onTarget ? 'bg-green-400' : 'bg-amber-400'}`}
              />
              <span className="text-lg font-semibold text-white">
                {onTarget ? 'On Target' : `$${Math.max(0, target - revenue).toLocaleString()} short of target`}
              </span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-300">
              <span>
                <span className="font-mono font-semibold text-white">{usd(revenue)}</span> Settled to date
              </span>
              <span>
                <span className="font-mono font-semibold text-white">{usd(target)}</span> Monthly target (day {strategy.runwayDays})
              </span>
            </div>
          </div>
        </div>

        {/* ── Pipeline velocity ────────────────────────────────────────── */}
        <section>
          <h2 className="text-xl font-semibold text-white mb-4">Pipeline Velocity</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {(
              [
                ['Leads', dash.velocity.leads],
                ['Won', dash.velocity.won],
                ['Invoiced', dash.velocity.invoiced],
                ['Paid', dash.velocity.paid],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/[0.06] bg-gray-900/60 p-4">
                <div className="text-2xl font-bold text-white font-mono">{value}</div>
                <div className="text-xs text-gray-500 mt-1 uppercase tracking-wider">{label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Service lines ────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xl font-semibold text-white mb-4">Service Lines</h2>
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] bg-gray-900/80 text-gray-400 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3 text-left font-medium" scope="col">Service</th>
                  <th className="px-4 py-3 text-left font-medium" scope="col">Billing</th>
                  <th className="px-4 py-3 text-right font-medium" scope="col">Target/mo</th>
                  <th className="px-4 py-3 text-right font-medium" scope="col">Won (USD)</th>
                  <th className="px-4 py-3 text-right font-medium" scope="col">Paid (USD)</th>
                  <th className="px-4 py-3 text-right font-medium" scope="col">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {strategy.services.map((svc) => {
                  const ue = unitEconomics(svc);
                  const stats = dash.byService[svc.id];
                  return (
                    <tr key={svc.id} className="bg-gray-900/40 hover:bg-gray-900/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{svc.name}</div>
                        <div className="text-[11px] text-gray-500 font-mono">{svc.id}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{svc.billing.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 text-right text-gray-300 font-mono">{usd(svc.targetMonthly)}</td>
                      <td className="px-4 py-3 text-right text-gray-300 font-mono">{usd(stats.won)}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-400">{usd(stats.paid)}</td>
                      <td className="px-4 py-3 text-right text-gray-300 font-mono">{ue.marginPct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Opportunities ────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xl font-semibold text-white mb-4">
            Opportunities <span className="text-sm font-normal text-gray-500">({opportunities.length})</span>
          </h2>
          {opportunities.length === 0 ? (
            <p className="text-sm text-gray-500">No opportunities yet. Add one via POST /api/mission/opportunities.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-gray-900/80 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-left font-medium" scope="col">Name</th>
                    <th className="px-4 py-3 text-left font-medium" scope="col">Service</th>
                    <th className="px-4 py-3 text-left font-medium" scope="col">Stage</th>
                    <th className="px-4 py-3 text-right font-medium" scope="col">Value/mo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {opportunities.map((o) => (
                    <tr key={o.id} className="bg-gray-900/40 hover:bg-gray-900/60 transition-colors">
                      <td className="px-4 py-3 font-medium text-white max-w-xs truncate">{o.name}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-300 font-mono">
                          {o.serviceId ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STAGE_COLORS[o.stage] ?? 'bg-gray-500/20 text-gray-400'}`}>
                          {o.stage}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300 font-mono">{usd(o.monthlyValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="border-t border-white/5 pt-6 pb-4">
          <p className="text-xs text-gray-600 text-center">
            Mission engine · settled revenue only counts toward the target · pipeline is not revenue
          </p>
        </div>
      </div>
    </div>
  );
}
