'use client';

/**
 * Global error boundary — catches any unhandled errors in route segments.
 * Renders a dark-themed error page consistent with the Draymond UI.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md w-full rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
        <p className="text-4xl mb-4 opacity-60">&#x26A0;</p>
        <h2 className="text-lg font-bold text-white mb-2">Something went wrong</h2>
        <p className="text-sm text-white/50 mb-6">
          {error.digest
            ? `Error ID: ${error.digest}`
            : 'An unexpected error occurred. Please try again.'}
        </p>
        <button
          onClick={reset}
          className="rounded-lg bg-white/10 border border-white/20 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
