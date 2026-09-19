'use client';

import { useEffect, useState } from 'react';

export type OrchestratorHealth = 'checking' | 'online' | 'offline';

/**
 * Real liveness probe for the orchestrator. Starts as `checking` and flips to
 * `online` only after `/api/v1/health` responds OK, so UI status indicators
 * never show a hardcoded green.
 */
export function useOrchestratorHealth(intervalMs = 60_000): OrchestratorHealth {
  const [status, setStatus] = useState<OrchestratorHealth>('checking');

  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        const res = await fetch('/api/v1/health', { cache: 'no-store' });
        if (alive) setStatus(res.ok ? 'online' : 'offline');
      } catch {
        if (alive) setStatus('offline');
      }
    };
    probe();
    const timer = setInterval(probe, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return status;
}
