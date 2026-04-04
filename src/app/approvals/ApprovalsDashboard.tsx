'use client';

import { useState, useTransition, useEffect, useCallback } from 'react';
import { approveAction, rejectAction } from './actions';
import type { DraymondAction } from '@/lib/draymond/types';

// ---------------------------------------------------------------------------
// Status badge colors
// ---------------------------------------------------------------------------

const RISK_COLORS: Record<string, string> = {
  safe: 'bg-green-500/20 text-green-400',
  low: 'bg-blue-500/20 text-blue-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  high: 'bg-orange-500/20 text-orange-400',
  critical: 'bg-red-500/20 text-red-400',
};

/** Auto-refresh interval for polling new actions (item 39). */
const REFRESH_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ApprovalsDashboard({
  initialActions,
}: {
  initialActions: DraymondAction[];
}) {
  const [actions, setActions] = useState(initialActions);
  const [isPending, startTransition] = useTransition();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null); // item 37

  // Auto-refresh via page reload (item 39)
  useEffect(() => {
    const timer = setInterval(() => {
      // Use router.refresh() pattern — simplest way to get fresh server data
      window.location.reload();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Clear error message after 5 seconds
  useEffect(() => {
    if (!errorMessage) return;
    const timer = setTimeout(() => setErrorMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [errorMessage]);

  const handleApprove = useCallback(function handleApprove(actionId: string) {
    setProcessingId(actionId);
    setErrorMessage(null);
    startTransition(async () => {
      try {
        await approveAction(actionId, noteInputs[actionId]);
        setActions((prev) => prev.filter((a) => a.id !== actionId));
      } catch (err) {
        // Show error to user (item 37)
        const msg = err instanceof Error ? err.message : 'Failed to approve action';
        setErrorMessage(msg);
        console.error('Failed to approve action:', err);
      } finally {
        setProcessingId(null);
      }
    });
  }, [noteInputs]);

  const handleReject = useCallback(function handleReject(actionId: string) {
    setProcessingId(actionId);
    setErrorMessage(null);
    startTransition(async () => {
      try {
        await rejectAction(actionId, noteInputs[actionId]);
        setActions((prev) => prev.filter((a) => a.id !== actionId));
      } catch (err) {
        // Show error to user (item 37)
        const msg = err instanceof Error ? err.message : 'Failed to reject action';
        setErrorMessage(msg);
        console.error('Failed to reject action:', err);
      } finally {
        setProcessingId(null);
      }
    });
  }, [noteInputs]);

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  }

  if (actions.length === 0) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-16">
        <div className="rounded-xl bg-white/5 border border-white/10 p-10 text-center">
          <p className="text-4xl mb-4 opacity-40">&#x2714;&#xFE0F;</p>
          <p className="text-white/40 text-lg">All clear</p>
          <p className="text-white/20 text-sm mt-1">
            No pending approvals. Actions will appear here when agents request human review.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Error banner (item 37) */}
      {errorMessage && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errorMessage}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] bg-gray-900/80 text-gray-400 text-xs uppercase tracking-wider">
              <th className="px-4 py-3 text-left font-medium">Action</th>
              <th className="px-4 py-3 text-left font-medium">Risk</th>
              <th className="px-4 py-3 text-left font-medium">Confidence</th>
              <th className="px-4 py-3 text-left font-medium">Submitted</th>
              <th className="px-4 py-3 text-right font-medium">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {actions.map((action) => {
              const isProcessing = processingId === action.id;
              const isExpanded = expandedId === action.id;

              return (
                <tr
                  key={action.id}
                  className="bg-gray-900/40 hover:bg-gray-900/60 transition-colors"
                >
                  {/* Action info */}
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        setExpandedId(isExpanded ? null : action.id)
                      }
                      className="text-left"
                    >
                      <p className="font-medium text-white">
                        {action.action_type}
                      </p>
                      <p className="text-white/40 text-xs mt-0.5 max-w-xs truncate">
                        {action.description}
                      </p>
                    </button>
                  </td>

                  {/* Risk */}
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        RISK_COLORS[action.risk_level] || 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {action.risk_level}
                    </span>
                  </td>

                  {/* Confidence */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#22c55e]"
                          style={{
                            width: `${Math.round(action.confidence_score * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-white/60 text-xs font-mono">
                        {(action.confidence_score * 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>

                  {/* Time */}
                  <td className="px-4 py-3 text-white/40 text-xs">
                    {formatTime(action.created_at)}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleApprove(action.id)}
                        disabled={isProcessing || isPending}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors bg-[#22c55e]/20 text-[#22c55e] hover:bg-[#22c55e]/30 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isProcessing ? '...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleReject(action.id)}
                        disabled={isProcessing || isPending}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isProcessing ? '...' : 'Reject'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Expanded detail panel */}
      {expandedId && (() => {
        const action = actions.find((a) => a.id === expandedId);
        if (!action) return null;

        return (
          <div className="mt-4 rounded-xl border border-white/[0.06] bg-gray-900/60 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">
                {action.action_type}
              </h3>
              <button
                onClick={() => setExpandedId(null)}
                className="text-white/40 hover:text-white text-xs"
              >
                Close
              </button>
            </div>

            <p className="text-white/60 text-sm mb-4">{action.description}</p>

            {/* Confidence reasoning */}
            {action.confidence_reasoning && (
              <div className="mb-4">
                <p className="text-xs font-bold tracking-widest uppercase text-white/40 mb-1">
                  Confidence Reasoning
                </p>
                <p className="text-white/50 text-xs font-mono bg-white/5 rounded-lg p-3">
                  {action.confidence_reasoning}
                </p>
              </div>
            )}

            {/* Payload */}
            {action.payload && Object.keys(action.payload).length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-bold tracking-widest uppercase text-white/40 mb-1">
                  Payload
                </p>
                <pre className="text-white/50 text-xs font-mono bg-white/5 rounded-lg p-3 overflow-x-auto max-h-40 overflow-y-auto">
                  {JSON.stringify(action.payload, null, 2)}
                </pre>
              </div>
            )}

            {/* Review notes input */}
            <div className="mb-4">
              <p className="text-xs font-bold tracking-widest uppercase text-white/40 mb-1">
                Review Notes (optional)
              </p>
              <textarea
                value={noteInputs[action.id] || ''}
                onChange={(e) =>
                  setNoteInputs((prev) => ({
                    ...prev,
                    [action.id]: e.target.value,
                  }))
                }
                placeholder="Add notes for the audit trail..."
                maxLength={2000}
                className="w-full rounded-lg bg-white/5 border border-white/10 text-white text-sm px-3 py-2 placeholder:text-white/20 focus:outline-none focus:border-white/20 resize-none"
                rows={2}
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleApprove(action.id)}
                disabled={processingId === action.id || isPending}
                className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-[#22c55e] hover:bg-[#16a34a] text-black disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Approve Action
              </button>
              <button
                onClick={() => handleReject(action.id)}
                disabled={processingId === action.id || isPending}
                className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Reject Action
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
