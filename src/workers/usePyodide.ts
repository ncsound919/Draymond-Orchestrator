/**
 * usePyodide — general-purpose Python execution hook backed by the shared
 * PyodideWorkerManager. Ported from @mathx/web.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { getPyodideManager } from './PyodideWorkerManager';

export interface PyodideStatus {
  ready: boolean;
  loading: boolean;
  kernelCleared: boolean;
  extraPackages: string[];
}

export function usePyodide() {
  const [status, setStatus] = useState<PyodideStatus>({
    ready: false,
    loading: true,
    kernelCleared: false,
    extraPackages: [],
  });

  useEffect(() => {
    const manager = getPyodideManager();

    // Always route readiness through the async channel (a sync setState in the
    // effect body trips react-hooks/set-state-in-effect).
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        await manager.run('pass');
        if (!cancelled) setStatus((s) => ({ ...s, ready: true, loading: false }));
      } catch {
        if (!cancelled) timer = setTimeout(check, 500);
      }
    };
    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const compute = useCallback(async (code: string): Promise<string> => {
    return getPyodideManager().run(code);
  }, []);

  const loadExtra = useCallback(async (packages: string[]): Promise<string> => {
    const manager = getPyodideManager();
    const loaded = await manager.loadPackages(packages);
    if (loaded.length > 0) {
      setStatus((s) => ({
        ...s,
        extraPackages: [...new Set([...s.extraPackages, ...loaded])],
      }));
    }
    return loaded.join(',');
  }, []);

  const clearKernel = useCallback(async (): Promise<void> => {
    await getPyodideManager().clear();
    setStatus((s) => ({ ...s, kernelCleared: true }));
    setTimeout(() => setStatus((s) => ({ ...s, kernelCleared: false })), 2000);
  }, []);

  const { ready, loading } = status;

  return { status, ready, loading, compute, loadExtra, clearKernel };
}
