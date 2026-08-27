// src/components/visualizer/useSnapshot.ts
'use client';
import { useEffect, useState } from 'react';
import type { SimState, SnapshotPayload } from './state/types';
import { initialState, simReducer } from './state/reducer';
import { mapSseEnvelope } from './state/eventMappings';

export interface UseSnapshotResult {
  state: SimState;
  dispatchEvent: (env: { type: string; data: Record<string, unknown>; ts: string }) => void;
  lastLoadedAt: string | null;
}

export function useVisualizerState(pollMs = 30_000): UseSnapshotResult {
  const [state, setState] = useState<SimState>(initialState);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const applySnapshot = (snap: unknown) => {
    const payload = snap as SnapshotPayload;
    setState((s) => simReducer(s, { type: 'APPLY_SNAPSHOT', payload }));
    setLastLoadedAt(new Date().toISOString());
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/visualizer/snapshot', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const snap = await res.json();
        if (alive) applySnapshot(snap);
      } catch {
        if (alive) setState((s) => simReducer(s, { type: 'SIGNAL_LOST' }));
      }
    };
    load();
    const id = setInterval(load, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [pollMs]);

  const dispatchEvent = (env: { type: string; data: Record<string, unknown>; ts: string }) => {
    const actions = mapSseEnvelope(env);
    if (actions.length === 0) return;
    setState((s) => actions.reduce(simReducer, s));
  };

  return { state, dispatchEvent, lastLoadedAt };
}