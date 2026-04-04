'use client';

import { useState, useTransition } from 'react';
import { runWorkflow } from './actions';

export default function RunWorkflowButton({ chainId }: { chainId: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    chain_id: string;
    status: string;
    steps: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRun() {
    if (isPending) return; // double-click guard
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const res = await runWorkflow(chainId);
        setResult(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to run workflow');
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleRun}
        disabled={isPending}
        className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors bg-[#22c55e] hover:bg-[#16a34a] text-black disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isPending ? 'Running...' : 'Run Workflow'}
      </button>

      {result && (
        <span className="rounded-md bg-emerald-500/20 px-2 py-1 text-xs text-emerald-400 font-medium">
          {result.status === 'completed' ? 'Completed' : result.status} ({result.steps} steps)
        </span>
      )}

      {error && (
        <span className="rounded-md bg-red-500/20 px-2 py-1 text-xs text-red-400 font-medium max-w-[200px] truncate">
          {error}
        </span>
      )}
    </div>
  );
}
