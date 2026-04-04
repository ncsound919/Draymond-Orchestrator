export default function AdminLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8 animate-pulse">
      <div>
        <div className="h-8 w-36 bg-white/10 rounded-lg" />
        <div className="h-4 w-56 bg-white/5 rounded mt-2" />
      </div>
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-white/5 border border-white/10 p-5 space-y-2">
            <div className="h-3 w-20 bg-white/5 rounded" />
            <div className="h-7 w-12 bg-white/10 rounded" />
          </div>
        ))}
      </div>
      {/* Content area */}
      <div className="rounded-xl bg-white/5 border border-white/10 p-6 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-4 bg-white/5 rounded w-full" />
        ))}
      </div>
    </div>
  );
}
