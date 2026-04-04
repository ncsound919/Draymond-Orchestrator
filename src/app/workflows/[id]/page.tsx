/**
 * /workflows/[id] — Workflow detail page
 *
 * Server component that fetches a single chain template, its steps,
 * and renders full detail with run/delete actions.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getChain, getChainSteps } from '@/lib/draymond/chains';
import RunWorkflowButton from './RunWorkflowButton';
import DeleteWorkflowButton from './DeleteWorkflowButton';

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

const STEP_STATUS_STYLES: Record<string, string> = {
  pending:        'bg-gray-500/20 text-gray-400',
  waiting:        'bg-yellow-500/20 text-yellow-400',
  running:        'bg-blue-500/20 text-blue-400',
  completed:      'bg-emerald-500/20 text-emerald-400',
  failed:         'bg-red-500/20 text-red-400',
  skipped:        'bg-white/10 text-white/30',
  blocked:        'bg-orange-500/20 text-orange-400',
  pending_review: 'bg-violet-500/20 text-violet-400',
  approved:       'bg-emerald-500/20 text-emerald-400',
  rejected:       'bg-red-500/20 text-red-400',
  retrying:       'bg-amber-500/20 text-amber-400',
};

const RISK_STYLES: Record<string, string> = {
  safe:     'bg-white/10 text-white/40',
  low:      'bg-emerald-500/20 text-emerald-400',
  medium:   'bg-yellow-500/20 text-yellow-400',
  high:     'bg-orange-500/20 text-orange-400',
  critical: 'bg-red-500/20 text-red-400',
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
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let chain: Awaited<ReturnType<typeof getChain>>;
  let steps: Awaited<ReturnType<typeof getChainSteps>> = [];

  try {
    [chain, steps] = await Promise.all([
      getChain(id),
      getChainSteps(id),
    ]);
  } catch (err) {
    console.error('[WorkflowDetailPage] Failed to load chain:', err);
    notFound();
  }

  if (!chain) notFound();

  return (
    <div className="min-h-screen text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-6">
        <div className="max-w-7xl mx-auto">
          {/* Back link */}
          <Link
            href="/workflows"
            className="inline-flex items-center gap-1 text-white/40 hover:text-white/70 text-sm mb-4 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to Workflows
          </Link>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black tracking-tight">{chain.name}</h1>
              {chain.description && (
                <p className="text-white/60 text-sm mt-1 max-w-2xl">
                  {chain.description}
                </p>
              )}

              {/* Meta badges */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {/* Status */}
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                    STATUS_STYLES[chain.status] ?? STATUS_STYLES.draft
                  }`}
                >
                  {chain.status}
                </span>

                {/* Version */}
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/50 font-mono">
                  v{chain.version}
                </span>

                {/* Trigger */}
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    TRIGGER_STYLES[chain.trigger_type] ?? 'bg-white/10 text-white/50'
                  }`}
                >
                  {chain.trigger_type}
                </span>

                {/* Steps count */}
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/50">
                  {steps.length} step{steps.length !== 1 ? 's' : ''}
                </span>

                {/* Created date */}
                <span className="text-xs text-white/30">
                  Created {formatDate(chain.created_at)}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 gap-2">
              <RunWorkflowButton chainId={chain.id} />
              <DeleteWorkflowButton chainId={chain.id} chainName={chain.name} />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* ================================================================ */}
        {/* STEPS */}
        {/* ================================================================ */}
        <section>
          <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">
            Steps
          </h2>

          {steps.length === 0 ? (
            <div className="rounded-xl bg-white/5 border border-white/10 p-8 text-center">
              <p className="text-white/40 text-sm">No steps defined for this workflow.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {steps.map((step, idx) => (
                <div
                  key={step.id}
                  className="rounded-xl bg-white/5 border border-white/10 p-5 flex items-start gap-4"
                >
                  {/* Order indicator */}
                  <div className="shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-white/60">
                    {idx + 1}
                  </div>

                  {/* Step details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-white truncate">{step.name}</h3>
                      {/* Step status badge */}
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                          STEP_STATUS_STYLES[step.status] ?? STEP_STATUS_STYLES.pending
                        }`}
                      >
                        {step.status}
                      </span>
                    </div>

                    {step.description && (
                      <p className="text-white/50 text-sm mb-2">{step.description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {/* Entity */}
                      <span className="rounded-md bg-white/10 px-2 py-0.5 text-white/50 font-mono truncate max-w-[200px]">
                        {step.entity_id}
                      </span>

                      {/* Action */}
                      <span className="rounded-md bg-cyan-500/15 px-2 py-0.5 text-cyan-400 font-medium">
                        {step.action}
                      </span>

                      {/* Risk level */}
                      <span
                        className={`rounded-md px-2 py-0.5 font-semibold uppercase ${
                          RISK_STYLES[step.risk_level] ?? RISK_STYLES.low
                        }`}
                      >
                        {step.risk_level}
                      </span>

                      {/* Retries */}
                      <span className="text-white/30">
                        max {step.max_retries} retries
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ================================================================ */}
        {/* EXECUTION HISTORY PLACEHOLDER */}
        {/* ================================================================ */}
        <section>
          <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">
            Execution History
          </h2>
          <div className="rounded-xl bg-white/5 border border-white/10 p-8 text-center">
            <p className="text-white/30 text-sm">
              Execution history will appear here once this workflow has been run.
            </p>
          </div>
        </section>

        {/* ================================================================ */}
        {/* CONFIGURATION */}
        {/* ================================================================ */}
        <section>
          <h2 className="text-xs font-bold tracking-widest uppercase text-white/40 mb-3">
            Configuration
          </h2>
          <div className="rounded-xl bg-white/5 border border-white/10 p-5">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-white/40 text-xs uppercase tracking-wider">Slug</dt>
                <dd className="text-white/80 font-mono mt-0.5">{chain.slug}</dd>
              </div>
              <div>
                <dt className="text-white/40 text-xs uppercase tracking-wider">Max Retries</dt>
                <dd className="text-white/80 font-mono mt-0.5">{chain.max_retries}</dd>
              </div>
              <div>
                <dt className="text-white/40 text-xs uppercase tracking-wider">Template</dt>
                <dd className="text-white/80 mt-0.5">{chain.is_template ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt className="text-white/40 text-xs uppercase tracking-wider">Total Steps</dt>
                <dd className="text-white/80 font-mono mt-0.5">{chain.total_steps}</dd>
              </div>
              {chain.template_id && (
                <div>
                  <dt className="text-white/40 text-xs uppercase tracking-wider">Template ID</dt>
                  <dd className="text-white/80 font-mono mt-0.5 truncate">{chain.template_id}</dd>
                </div>
              )}
              <div>
                <dt className="text-white/40 text-xs uppercase tracking-wider">Chain ID</dt>
                <dd className="text-white/80 font-mono mt-0.5 truncate">{chain.id}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}
