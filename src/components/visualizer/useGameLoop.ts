// src/components/visualizer/useGameLoop.ts
'use client';
import { useEffect } from 'react';

export function useGameLoop(cb: (now: number, dt: number) => void): void {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(100, t - last);
      last = t;
      cb(t, dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cb]);
}