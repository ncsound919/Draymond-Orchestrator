export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getPendingActions } from '@/lib/draymond/index';
import ApprovalsDashboard from './ApprovalsDashboard';

export default async function ApprovalsPage() {
  let pendingActions: Awaited<ReturnType<typeof getPendingActions>> = [];
  let loadError: string | null = null;

  try {
    pendingActions = await getPendingActions();
  } catch (err) {
    console.error('[ApprovalsPage] Failed to load pending actions:', err);
    loadError = err instanceof Error ? err.message : 'Failed to load approvals';
  }

  return (
    <div className="min-h-screen text-white">
      {/* Header section */}
      <div className="border-b border-white/10 px-6 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Approvals</h1>
            <p className="text-white/40 text-sm mt-1">
              {loadError
                ? 'Approval queue unavailable'
                : `${pendingActions.length} action${pendingActions.length !== 1 ? 's' : ''} awaiting review`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {loadError && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 text-red-300 px-3 py-1 text-xs font-medium">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />
                Queue unavailable
              </span>
            )}
            {!loadError && pendingActions.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/20 text-yellow-400 px-3 py-1 text-xs font-medium">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                Needs Attention
              </span>
            )}
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
            <p className="font-semibold mb-1">Could not load the approval queue</p>
            <p className="text-red-200/80">
              Items may be pending that are not shown — do not treat this as an empty queue.
              {' '}{loadError}
            </p>
          </div>
        </div>
      ) : (
        <ApprovalsDashboard initialActions={pendingActions} />
      )}
    </div>
  );
}
