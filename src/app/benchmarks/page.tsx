import type { Metadata } from 'next';
import { latestBenchmarks, upgradeQueue } from '@/lib/benchmarks/queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Benchmarks',
};

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
  const [rows, queue] = await Promise.all([
    latestBenchmarks(200).catch((err) => { console.error('[BenchmarksPage] Failed to load benchmarks:', err); return [] as Awaited<ReturnType<typeof latestBenchmarks>>; }),
    upgradeQueue('queued').catch((err) => { console.error('[BenchmarksPage] Failed to load upgrade queue:', err); return [] as Awaited<ReturnType<typeof upgradeQueue>>; }),
  ]);

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

  return (
    <div className="min-h-screen text-white p-8">
      <h1 className="text-3xl font-bold text-white mb-2">Benchmarks</h1>
      <p className="text-sm text-white/60 mb-8">
        Weakness scores: 0 = healthy, 100 = worst. Tracked entities, sites, crons, chains.
      </p>

      <section className="mb-10">
        <h2 className="text-xl font-semibold text-white mb-4">Upgrade Queue</h2>
        {queue.length === 0 ? (
          <p className="text-white/50">No queued upgrades.</p>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead><tr className="border-b-2 border-white/10">
              <th className="p-2 text-white/70">Component</th><th className="p-2 text-white/70">Class</th>
              <th className="p-2 text-white/70">Score</th><th className="p-2 text-white/70">Action</th>
            </tr></thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.id} className="border-b border-white/10">
                  <td className="p-2 font-medium">{q.component_name}</td>
                  <td className="p-2 text-sm text-white/60">{q.component_class}</td>
                  <td className="p-2">{q.weakness_score}</td>
                  <td className="p-2 text-sm">{q.proposed_action ?? '—'}</td>
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
                <td className="p-2"><Sparkline values={[]} /></td>
                <td className="p-2 text-xs text-white/50">{new Date(r.run_at).toISOString().slice(0, 10)}</td>
              </tr>
            ))}
            {ranked.length === 0 && <tr><td className="p-2 text-white/50" colSpan={5}>No benchmark data yet. Run a benchmark job.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
