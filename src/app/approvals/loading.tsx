export default function ApprovalsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8 animate-pulse">
      <div>
        <div className="h-8 w-44 bg-white/10 rounded-lg" />
        <div className="h-4 w-64 bg-white/5 rounded mt-2" />
      </div>
      {/* Filter tabs */}
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 bg-white/5 rounded-lg" />
        ))}
      </div>
      {/* Approval cards */}
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-white/5 border border-white/10 p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-5 w-48 bg-white/10 rounded" />
              <div className="h-6 w-20 bg-white/5 rounded-full" />
            </div>
            <div className="h-3 w-72 bg-white/5 rounded" />
            <div className="flex gap-2 mt-2">
              <div className="h-9 w-24 bg-emerald-500/10 rounded-lg" />
              <div className="h-9 w-24 bg-red-500/10 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
