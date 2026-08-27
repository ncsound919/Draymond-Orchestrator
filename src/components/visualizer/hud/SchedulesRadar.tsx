// src/components/visualizer/hud/SchedulesRadar.tsx
'use client';
import { useState } from 'react';
import type { RadarBlip } from '../state/types';

/** Circular radar: blips at angle by minutes-to-next-run; sweep rotates via CSS. */
export function SchedulesRadar({ blips }: { blips: RadarBlip[] }) {
  const [now] = useState(() => Date.now());
  const ring = blips.slice(0, 12).map((b) => {
    const mins = b.nextRunAt ? Math.max(0, (new Date(b.nextRunAt).getTime() - now) / 60000) : 9999;
    const angle = (mins % 360) * (Math.PI / 180);
    const r = Math.min(120, 20 + (mins > 300 ? 60 : mins / 5));
    return { ...b, x: Math.cos(angle) * r, y: Math.sin(angle) * r, mins: Math.round(mins) };
  });
  return (
    <div className="pointer-events-none absolute left-4 bottom-20 z-20 h-40 w-40 rounded-full border border-cyan-400/30 bg-black/30 backdrop-blur">
      <div className="absolute left-1/2 top-1/2 h-px w-full origin-left animate-spin bg-cyan-400/40" style={{ animationDuration: '8s' }} />
      {ring.map((b) => (
        <div key={b.jobId} title={`${b.name} · ${b.mins}m`}
          className="absolute h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_6px_#22d3ee]"
          style={{ left: `calc(50% + ${b.x}px)`, top: `calc(50% + ${b.y}px)` }} />
      ))}
    </div>
  );
}
