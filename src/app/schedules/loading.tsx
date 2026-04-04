export default function SchedulesLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8 animate-pulse">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-44 bg-white/10 rounded-lg" />
          <div className="h-4 w-40 bg-white/5 rounded mt-2" />
        </div>
        <div className="h-10 w-32 bg-white/5 rounded-lg" />
      </div>
      {/* Table skeleton */}
      <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
        <div className="px-5 py-3 bg-white/[0.02] border-b border-white/10">
          <div className="h-3 w-full bg-white/5 rounded" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-5 py-4 border-b border-white/5 flex items-center gap-6">
            <div className="h-4 w-32 bg-white/10 rounded" />
            <div className="h-4 w-24 bg-white/5 rounded" />
            <div className="h-4 w-16 bg-white/5 rounded" />
            <div className="h-4 w-20 bg-white/5 rounded-full" />
            <div className="h-5 w-9 bg-white/5 rounded-full ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
