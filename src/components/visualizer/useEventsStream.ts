// src/components/visualizer/useEventsStream.ts
'use client';
import { useEffect } from 'react';
import type { UseSnapshotResult } from './useSnapshot';

export function useEventsStream({ dispatchEvent, onReconnect }: { dispatchEvent: UseSnapshotResult['dispatchEvent']; onReconnect: () => void }): void {
  useEffect(() => {
    let alive = true;
    let retry = 0;
    let controller: AbortController | null = null;

    const connect = async () => {
      controller = new AbortController();
      try {
        const res = await fetch('/api/visualizer/stream', { signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (alive) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data: ')) continue;
            if (line === 'data: : ping') continue;
            try {
              const env = JSON.parse(line.slice(6));
              dispatchEvent(env);
            } catch { /* ignore malformed */ }
          }
        }
      } catch {
        if (!alive) return;
      }
      if (!alive) return;
      retry += 1;
      const delay = Math.min(5000, 500 * 2 ** retry);
      setTimeout(() => { if (alive) { onReconnect(); connect(); } }, delay);
    };

    connect();
    return () => { alive = false; controller?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}