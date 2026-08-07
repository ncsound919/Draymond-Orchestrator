'use client';

import { useTransition } from 'react';
import { resolveQueueItem } from './actions';

/**
 * Complete / Dismiss buttons for a queued upgrade item.
 * Disabled while the server action is in flight.
 */
export default function QueueActions({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  const act = (outcome: 'completed' | 'dismissed') => {
    startTransition(async () => {
      try {
        await resolveQueueItem(id, outcome);
      } catch (err) {
        console.error(`[Benchmarks] failed to resolve queue item ${id}:`, err);
      }
    });
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={() => act('completed')}
        disabled={pending}
        className="px-2 py-1 text-xs rounded bg-[#22c55e]/20 text-[#22c55e] hover:bg-[#22c55e]/30 disabled:opacity-50"
      >
        Done
      </button>
      <button
        onClick={() => act('dismissed')}
        disabled={pending}
        className="px-2 py-1 text-xs rounded bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-50"
      >
        Dismiss
      </button>
    </div>
  );
}
