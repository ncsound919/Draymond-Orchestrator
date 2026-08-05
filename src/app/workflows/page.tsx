/**
 * /workflows — Chain template listing page
 *
 * Server component that fetches all workflow templates from the Draymond
 * chain engine and renders them as a filterable grid of glass cards.
 */
import Link from 'next/link';
import { listChains } from '@/lib/draymond/chains';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-gray-500/20 text-gray-400',
  active:    'bg-emerald-500/20 text-emerald-400',
  running:   'bg-blue-500/20 text-blue-400',
  paused:    'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-sky-500/20 text-sky-400',
  failed:    'bg-red-500/20 text-red-400',
  cancelled: 'bg-orange-500/20 text-orange-400',
  archived:  'bg-white/10 text-white/30',
};

const TRIGGER_STYLES: Record<string, string> = {
  manual:    'bg-violet-500/20 text-violet-400',
  scheduled: 'bg-amber-500/20 text-amber-400',
  api:       'bg-cyan-500/20 text-cyan-400',
  webhook:   'bg-pink-500/20 text-pink-400',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function WorkflowsPage() {
  let chains: Awaited<ReturnType<typeof listChains>> = [];
  let fetchError = false;

  try {
    chains = await listChains({ is_template: true });
  } catch (err) {
    console.error('[WorkflowsPage] Failed to load chains:', err);
    fetchError = true;
  }

  if (fetchError) {
    return (
      <div className="min-h-screen text-white">
        <div className="max-w-7xl mx-auto px-6 py-24 text-center">
          <p className="text-5xl mb-4 opacity-40">&#x26A0;</p>
          <h1 className="text-xl font-bold mb-2">Failed to load workflows</h1>
          <p className="text-white/40 text-sm">Could not fetch workflow templates. Check your database connection and try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Workflows</h1>
            <p className="text-white/40 text-sm mt-1">
              {chains.length} template{chains.length !== 1 ? 's' : ''} registered
            </p>
          </div>
          <Link
            href="/workflows/new"
            className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-[#22c55e] hover:bg-[#16a34a] text-black"
          >
            + New Workflow
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {chains.length === 0 ? (
          /* ---------- Empty state ---------- */
          <div className="text-center py-24">
            <p className="text-5xl mb-4 opacity-40">&#x2699;&#xFE0F;</p>
            <p className="text-white/40 text-lg">No workflow templates yet.</p>
            <Link
              href="/workflows/new"
              className="mt-6 inline-block rounded-xl px-6 py-3 bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold transition-colors"
            >
              Create your first workflow
            </Link>
          </div>
        ) : (
          /* ---------- Grid ---------- */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {chains.map((chain) => (
              <Link
                key={chain.id}
                href={`/workflows/${chain.id}`}
                className="group rounded-xl bg-white/5 border border-white/10 p-5 transition-colors hover:border-white/20 hover:bg-white/[0.07]"
              >
                {/* Top row: name + status */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="font-bold text-white group-hover:text-emerald-400 transition-colors truncate">
                    {chain.name}
                  </h3>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      STATUS_STYLES[chain.status] ?? STATUS_STYLES.draft
                    }`}
                  >
                    {chain.status}
                  </span>
                </div>

                {/* Description */}
                <p className="text-white/60 text-sm line-clamp-2 mb-4">
                  {chain.description || 'No description'}
                </p>

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {/* Version */}
                  <span className="rounded-md bg-white/10 px-2 py-0.5 text-white/50 font-mono">
                    v{chain.version}
                  </span>

                  {/* Trigger type */}
                  <span
                    className={`rounded-md px-2 py-0.5 font-medium ${
                      TRIGGER_STYLES[chain.trigger_type] ?? 'bg-white/10 text-white/50'
                    }`}
                  >
                    {chain.trigger_type}
                  </span>

                  {/* Steps count */}
                  <span className="rounded-md bg-white/10 px-2 py-0.5 text-white/50">
                    {chain.total_steps} step{chain.total_steps !== 1 ? 's' : ''}
                  </span>

                  {/* Spacer */}
                  <span className="flex-1" />

                  {/* Date */}
                  <span className="text-white/30">{formatDate(chain.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
