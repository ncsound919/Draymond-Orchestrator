export interface DreamReportProps {
  report: {
    lastDreamAt: string;
    sessionsCounted: number;
    phases: {
      oriented: { total: number; stale: number; duplicates: number };
      gathered: { events: number; outcomes: number; duplicateKeys: number; contradictedKeys: number };
      consolidated: { mergedKeys: number; correctedKeys: number; promoted: number; lessonsStored: number };
      pruned: { decayed: number; expired: number; indexEntries: number };
    };
    entries: string[];
    durationMs: number;
    gatedBy?: string;
    error?: string;
  } | null;
}

export default function DreamReport({ report }: DreamReportProps) {
  if (!report) {
    return (
      <p className="text-sm text-gray-500">
        No dream has completed yet. AutoDream runs nightly at 02:00 once the gates pass (24h + 5 sessions + idle).
      </p>
    );
  }
  const stats = [
    ['Oriented', report.phases.oriented.total],
    ['Merged keys', report.phases.consolidated.mergedKeys],
    ['Promoted', report.phases.consolidated.promoted],
    ['Pruned', report.phases.pruned.decayed + report.phases.pruned.expired],
    ['Index entries', report.phases.pruned.indexEntries],
    ['Sessions', report.sessionsCounted],
  ] as const;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-gray-900/60 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-400">
          Last dream: <span className="font-mono text-white">{new Date(report.lastDreamAt).toLocaleString()}</span>
        </span>
        {report.gatedBy && (
          <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs text-amber-400">gated: {report.gatedBy}</span>
        )}
        {report.error && (
          <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs text-red-400">error: {report.error}</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-gray-900/80 p-3">
            <div className="text-xl font-bold text-white font-mono">{value}</div>
            <div className="text-[11px] text-gray-500 mt-0.5 uppercase tracking-wider">{label}</div>
          </div>
        ))}
      </div>
      <div>
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Cycle log</h3>
        <ul className="space-y-1">
          {report.entries.map((entry, i) => (
            <li key={i} className="text-xs text-gray-400 font-mono">{entry}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
