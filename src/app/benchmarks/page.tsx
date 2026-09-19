import type { Metadata } from 'next';
import { latestBenchmarks, trendsFor, upgradeQueue } from '@/lib/benchmarks/queries';
import QueueActions from './QueueActions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Benchmarks',
};

/** Run a query, logging + tagging failure instead of silently blanking the page. */
async function settle<T>(promise: Promise<T>, fallback: T, label: string): Promise<{ ok: boolean; value: T }> {
  try {
    return { ok: true, value: await promise };
  } catch (err) {
    console.error(label, err);
    return { ok: false, value: fallback };
  }
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-sm text-white/50">no history</span>;
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-0.5 h-6">
      {values.map((v, i) => (
        <div key={i} className="w-2 rounded-sm" style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: v > 50 ? '#ef4444' : v > 25 ? '#c8a415' : '#22c55e' }} title={`${v}`} />
      ))}
    </div>
  );
}

export default async function BenchmarksPage() {
  const [benchRes, queueRes] = await Promise.all([
    settle(latestBenchmarks(200), [] as Awaited<ReturnType<typeof latestBenchmarks>>, '[BenchmarksPage] Failed to load benchmarks:'),
    settle(upgradeQueue('queued'), [] as Awaited<ReturnType<typeof upgradeQueue>>, '[BenchmarksPage] Failed to load upgrade queue:'),
  ]);
  const rows = benchRes.value;
  const queue = queueRes.value;

  const seen = new Set<string>();
  const ranked = [...rows]
    .filter((r) => {
      const key = `${r.component_class}:${r.component_slug}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.weakness_score - a.weakness_score)
    .slice(0, 50);

  // One batched query per class covers all 50 rows' sparklines.
  const trendsRes = await settle(
    trendsFor(ranked.map((r) => ({ component_class: r.component_class, component_slug: r.component_slug }))),
    {} as Record<string, number[]>,
    '[BenchmarksPage] Failed to load trends:',
  );
  const trends = trendsRes.value;
  const loadError = !benchRes.ok || !queueRes.ok || !trendsRes.ok;

  return (
    <div className="min-h-screen text-white p-8">
      <h1 className="text-3xl font-bold text-white mb-2">Benchmarks</h1>
      <p className="text-sm text-white/60 mb-8">
        Weakness scores: 0 = healthy, 100 = worst. Tracked entities, sites, crons, chains.
      </p>

      {loadError && (
        <div role="alert" className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <span className="font-semibold">Some benchmark data failed to load.</span>{' '}
          The tables below may be incomplete — an empty table here does not mean there is no data.
        </div>
      )}

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white mb-4">Upgrade Queue</h2>
        {queue.length === 0 ? (
          <p className="text-white/50">{loadError ? 'Upgrade queue unavailable.' : 'No queued upgrades.'}</p>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead><tr className="border-b-2 border-white/10">
              <th className="p-2 text-white/70">Component</th><th className="p-2 text-white/70">Class</th>
              <th className="p-2 text-white/70">Score</th><th className="p-2 text-white/70">Action</th>
              <th className="p-2 text-white/70">Review</th>
            </tr></thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.id} className="border-b border-white/10">
                  <td className="p-2 font-medium">{q.component_name}</td>
                  <td className="p-2 text-sm text-white/60">{q.component_class}</td>
                  <td className="p-2">{q.weakness_score}</td>
                  <td className="p-2 text-sm">{q.proposed_action ?? '—'}</td>
                  <td className="p-2"><QueueActions id={q.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-4">Weakest Components</h2>
        <table className="w-full text-left border-collapse">
          <thead><tr className="border-b-2 border-white/10">
            <th className="p-2 text-white/70">Component</th><th className="p-2 text-white/70">Class</th>
            <th className="p-2 text-white/70">Score</th><th className="p-2 text-white/70">Trend</th><th className="p-2 text-white/70">Run</th>
          </tr></thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.id} className="border-b border-white/10">
                <td className="p-2 font-medium">{r.component_name}</td>
                <td className="p-2 text-sm text-white/60">{r.component_class}</td>
                <td className="p-2">{r.weakness_score}</td>
                <td className="p-2"><Sparkline values={trends[`${r.component_class}:${r.component_slug}`] ?? []} /></td>
                <td className="p-2 text-xs text-white/50">{new Date(r.run_at).toISOString().slice(0, 10)}</td>
              </tr>
            ))}
            {ranked.length === 0 && <tr><td className="p-2 text-white/50" colSpan={5}>{loadError ? 'Benchmark data unavailable.' : 'No benchmark data yet. Run a benchmark job.'}</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
