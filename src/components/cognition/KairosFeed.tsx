'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export interface KairosMomentProps {
  id: string;
  kind: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
  source: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  acked: boolean;
}

const SEVERITY_STYLES: Record<string, string> = {
  info: 'border-white/[0.06] bg-gray-900/40',
  warn: 'border-amber-500/30 bg-amber-500/5',
  critical: 'border-red-500/40 bg-red-500/10',
};

const SEVERITY_TEXT: Record<string, string> = {
  info: 'text-blue-400',
  warn: 'text-amber-400',
  critical: 'text-red-400',
};

export default function KairosFeed({ moments }: { moments: KairosMomentProps[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function ack(id: string) {
    setBusy(id);
    startTransition(async () => {
      try {
        const res = await fetch('/api/cognition/kairos/ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) console.warn(`[kairos] ack returned ${res.status}`);
      } catch {
        /* best-effort */
      } finally {
        setBusy(null);
        router.refresh();
      }
    });
  }

  if (moments.length === 0) {
    return <p className="text-sm text-gray-500">No kairos moments. The daemon scans every 5 minutes.</p>;
  }

  return (
    <ul className="space-y-2">
      {moments.map((m) => (
        <li key={m.id} className={`rounded-xl border px-4 py-3 ${SEVERITY_STYLES[m.severity]}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold uppercase tracking-wider ${SEVERITY_TEXT[m.severity]}`}>{m.severity}</span>
                <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-300 font-mono">{m.kind}</span>
                <span className="text-[11px] text-gray-500 font-mono">{m.source}</span>
                {m.occurrences > 1 && <span className="text-[11px] text-gray-500">x{m.occurrences}</span>}
              </div>
              <p className="mt-1 text-sm font-medium text-white">{m.title}</p>
              <p className="mt-0.5 text-xs text-gray-400">{m.detail}</p>
            </div>
            {!m.acked && (
              <button
                type="button"
                onClick={() => ack(m.id)}
                disabled={isPending}
                className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-white/60 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
              >
                {busy === m.id ? '…' : 'Ack'}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
