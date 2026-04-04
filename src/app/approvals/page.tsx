export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getPendingActions } from '@/lib/draymond/index';
import ApprovalsDashboard from './ApprovalsDashboard';

export default async function ApprovalsPage() {
  const pendingActions = await getPendingActions();

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header section */}
      <div className="border-b border-white/10 px-6 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Approvals</h1>
            <p className="text-white/40 text-sm mt-1">
              {pendingActions.length} action{pendingActions.length !== 1 ? 's' : ''} awaiting review
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pendingActions.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/20 text-yellow-400 px-3 py-1 text-xs font-medium">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                Needs Attention
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Dashboard */}
      <ApprovalsDashboard initialActions={pendingActions} />
    </div>
  );
}
