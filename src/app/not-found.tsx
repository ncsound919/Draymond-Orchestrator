import Link from 'next/link';

/**
 * Custom 404 page — dark-themed, consistent with the Draymond UI.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <p className="text-6xl font-bold text-white/10 mb-4">404</p>
        <h2 className="text-lg font-bold text-white mb-2">Page not found</h2>
        <p className="text-sm text-white/50 mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-block rounded-lg bg-white/10 border border-white/20 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/15 transition-colors"
        >
          Back to Operations
        </Link>
      </div>
    </div>
  );
}
