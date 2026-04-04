'use client';

import { useState, useTransition } from 'react';
import { deleteWorkflowAction } from './actions';

export default function DeleteWorkflowButton({
  chainId,
  chainName,
}: {
  chainId: string;
  chainName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (isPending) return; // double-click guard
    setError(null);
    startTransition(async () => {
      try {
        await deleteWorkflowAction(chainId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete workflow');
      }
    });
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/40">Delete &ldquo;{chainName}&rdquo;?</span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? 'Deleting...' : 'Confirm'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white"
        >
          Cancel
        </button>
        {error && (
          <span className="text-xs text-red-400 max-w-[200px] truncate">{error}</span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-red-600 hover:bg-red-500 text-white"
    >
      Delete
    </button>
  );
}
