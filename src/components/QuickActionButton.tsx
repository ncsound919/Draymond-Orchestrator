'use client';

import { useState } from 'react';

const COLOR_STYLES = {
  green:
    'border-green-500/30 text-green-400 hover:bg-green-500/10 hover:border-green-500/50',
  blue: 'border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:border-blue-500/50',
  purple:
    'border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:border-purple-500/50',
  yellow:
    'border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 hover:border-yellow-500/50',
};

export default function QuickActionButton({
  label,
  endpoint,
  method,
  color,
}: {
  label: string;
  endpoint: string;
  method: string;
  color: 'green' | 'blue' | 'purple' | 'yellow';
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  async function handleClick() {
    setStatus('loading');
    try {
      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ''}`,
        },
        body: method === 'GET' ? undefined : JSON.stringify({}),
      });
      setStatus(res.ok ? 'success' : 'error');
    } catch {
      setStatus('error');
    }
    // Reset status after 3 seconds
    setTimeout(() => setStatus('idle'), 3000);
  }

  const statusIndicator =
    status === 'loading'
      ? ' ...'
      : status === 'success'
        ? ' \u2713'
        : status === 'error'
          ? ' \u2717'
          : '';

  return (
    <button
      onClick={handleClick}
      disabled={status === 'loading'}
      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${COLOR_STYLES[color]}`}
    >
      <span className="font-mono text-[10px] uppercase tracking-wider opacity-60">
        {method}
      </span>
      {label}{statusIndicator}
    </button>
  );
}
