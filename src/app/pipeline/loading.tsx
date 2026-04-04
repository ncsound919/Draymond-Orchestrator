export default function PipelineLoading() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-10 animate-pulse">
      <div>
        <div className="h-7 w-40 bg-white/10 rounded-lg" />
        <div className="h-4 w-80 bg-white/5 rounded mt-2" />
      </div>
      {/* Trigger form skeleton */}
      <div className="rounded-xl bg-white/5 border border-white/10 p-6 space-y-4">
        <div className="h-5 w-44 bg-white/10 rounded" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="h-10 bg-white/5 rounded-lg" />
          <div className="h-10 bg-white/5 rounded-lg" />
          <div className="h-10 bg-white/5 rounded-lg" />
          <div className="h-6 w-32 bg-white/5 rounded" />
        </div>
        <div className="h-10 w-36 bg-white/5 rounded-lg" />
      </div>
      {/* History table skeleton */}
      <div className="space-y-3">
        <div className="h-5 w-36 bg-white/10 rounded" />
        <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-3 border-b border-white/5 flex items-center gap-4">
              <div className="h-4 w-20 bg-white/10 rounded" />
              <div className="h-4 w-16 bg-white/5 rounded-full" />
              <div className="h-1.5 w-24 bg-white/5 rounded-full" />
              <div className="h-4 w-32 bg-white/5 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
