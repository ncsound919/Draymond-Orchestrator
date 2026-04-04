'use client';

/**
 * Root layout error boundary — catches errors that occur in the root layout itself.
 * Must render its own <html> and <body> since the root layout has failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0a',
          color: '#e5e7eb',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: '28rem',
            width: '100%',
            padding: '2rem',
            textAlign: 'center',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '1rem',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
          }}
        >
          <p style={{ fontSize: '2.5rem', marginBottom: '1rem', opacity: 0.6 }}>&#x26A0;</p>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            Critical Error
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)', marginBottom: '1.5rem' }}>
            {error.digest
              ? `Error ID: ${error.digest}`
              : 'The application encountered a critical error.'}
          </p>
          <button
            onClick={reset}
            style={{
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#fff',
              backgroundColor: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
