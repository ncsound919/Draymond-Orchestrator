export default function WorkflowsLoading() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8 animate-pulse">
      <div>
        <div className="h-8 w-44 bg-white/10 rounded-lg" />
        <div className="h-4 w-64 bg-white/5 rounded mt-2" />
      </div>
      {/* Workflow cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-white/5 border border-white/10 p-6 space-y-3">
            <div className="h-5 w-40 bg-white/10 rounded" />
            <div className="h-3 w-56 bg-white/5 rounded" />
            <div className="flex gap-2 mt-2">
              <div className="h-6 w-12 bg-white/5 rounded-full" />
              <div className="h-6 w-12 bg-white/5 rounded-full" />
              <div className="h-6 w-12 bg-white/5 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
