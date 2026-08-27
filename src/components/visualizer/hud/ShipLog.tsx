// src/components/visualizer/hud/ShipLog.tsx
'use client';
import type { ShipLogEntry } from '../state/types';
export function ShipLog({ entries }: { entries: ShipLogEntry[] }) {
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 max-h-40 overflow-hidden border-t border-white/10 bg-black/40 px-4 py-2 font-mono text-[11px] backdrop-blur">
      {entries.slice(0, 8).map((e) => (
        <div key={e.id} className={`${e.kind === 'fail' ? 'text-red-400' : e.kind === 'success' ? 'text-green-400' : 'text-cyan-200/70'} truncate`}>
          {e.text}
        </div>
      ))}
    </div>
  );
}