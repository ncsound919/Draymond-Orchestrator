// src/components/visualizer/hud/Inspector.tsx
'use client';
import type { Building } from '../state/types';
import { DISTRICT_LABELS } from '../state/layout';

export function Inspector({ building, onClose }: { building: Building; onClose: () => void }) {
  const color = building.health === 'down' ? 'text-red-400' : building.health === 'degraded' ? 'text-amber-400' : 'text-green-400';
  const district = DISTRICT_LABELS[building.district] ?? building.district;
  return (
    <div className="absolute right-4 top-16 z-30 w-64 rounded border border-white/15 bg-black/60 p-3 backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold">{building.name}</div>
          <div className="text-[11px] text-slate-400">{building.slug}</div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
      </div>
      <div className="mt-2 space-y-1 text-[11px]">
        <div>District: {district}</div>
        <div>Category: {building.category}</div>
        <div>Port: {building.port ?? 'stdio'}</div>
        <div className={color}>Status: {building.health.toUpperCase()}</div>
        <div>Grid: ({building.gridX}, {building.gridY}) · h{building.height}</div>
      </div>
    </div>
  );
}