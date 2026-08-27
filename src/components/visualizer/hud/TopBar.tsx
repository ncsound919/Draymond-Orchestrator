// src/components/visualizer/hud/TopBar.tsx
'use client';
interface Props {
  servicesUp: number;
  servicesTotal: number;
  revenueUsd: number;
  degraded: boolean;
  signalLost: boolean;
  lastLoadedAt: string | null;
}
export function TopBar({ servicesUp, servicesTotal, revenueUsd, degraded, signalLost, lastLoadedAt }: Props) {
  const pct = servicesTotal ? Math.round((servicesUp / servicesTotal) * 100) : 0;
  return (
    <div className="pointer-events-none absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-2 text-xs">
      <div className="flex items-center gap-4">
        <span className="text-sm font-bold tracking-widest text-cyan-300">OVERLAY365 FLEET</span>
        <span className={pct > 85 ? 'text-green-400' : pct > 50 ? 'text-amber-400' : 'text-red-400'}>
          HEALTH {pct}% ({servicesUp}/{servicesTotal})
        </span>
        <span className="text-emerald-300">REVENUE ${revenueUsd.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-3">
        {degraded && <span className="animate-pulse text-red-400">DEGRADED MODE</span>}
        {signalLost && <span className="animate-pulse text-red-400">SIGNAL LOST</span>}
        <span className="text-slate-400">{lastLoadedAt ?? '—'}</span>
      </div>
    </div>
  );
}