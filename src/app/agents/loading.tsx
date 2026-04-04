export default function AgentsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8 animate-pulse">
      {/* Header skeleton */}
      <div>
        <div className="h-8 w-48 bg-white/10 rounded-lg" />
        <div className="h-4 w-72 bg-white/5 rounded mt-2" />
      </div>
      {/* Agent card grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden"
          >
            <div className="h-32 bg-white/5" />
            <div className="p-5 space-y-3">
              <div className="h-5 w-32 bg-white/10 rounded" />
              <div className="h-3 w-48 bg-white/5 rounded" />
              <div className="flex gap-2">
                <div className="h-5 w-16 bg-white/5 rounded-full" />
                <div className="h-5 w-20 bg-white/5 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
