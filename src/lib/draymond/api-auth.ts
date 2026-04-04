// ============================================================================
// Shared API Authentication — CRON_SECRET Bearer Token
// ============================================================================
// Single source of truth for all Draymond API route authentication.
// Uses timing-safe string comparison to prevent timing attacks.
// Returns generic error messages to avoid leaking server configuration.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

/**
 * Timing-safe string comparison.
 * Returns false if lengths differ (without leaking which bytes differ).
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Authorize a request using the CRON_SECRET Bearer token.
 *
 * Returns `null` if authorized, or a `NextResponse` with the appropriate
 * error status to return immediately.
 *
 * Usage:
 * ```ts
 * const authError = authorizeRequest(request);
 * if (authError) return authError;
 * ```
 */
export function authorizeRequest(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Log the real issue server-side, but return a generic error to the caller
    console.error('[API Auth] CRON_SECRET env var is not set');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !safeCompare(token, cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null; // authorized
}

/**
 * Safely parse JSON from a request body.
 * Returns `{ data }` on success or `{ error: NextResponse }` on failure.
 */
export async function parseJsonBody<T = unknown>(
  request: NextRequest,
): Promise<{ data: T; error?: never } | { data?: never; error: NextResponse }> {
  try {
    const data = (await request.json()) as T;
    return { data };
  } catch {
    return {
      error: NextResponse.json(
        { ok: false, error: 'Invalid JSON body' },
        { status: 400 },
      ),
    };
  }
}

/**
 * Sanitize an error message before sending to the client.
 * Strips Supabase internal details (table names, constraint names, etc.).
 */
export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // Strip common Supabase/Postgres leak patterns
  if (raw.includes('duplicate key value violates unique constraint')) {
    return 'A record with this identifier already exists';
  }
  if (raw.includes('violates foreign key constraint')) {
    return 'Referenced record not found';
  }
  if (raw.includes('violates check constraint')) {
    return 'Invalid field value';
  }
  if (raw.includes('relation "') || raw.includes('column "')) {
    return 'Internal database error';
  }

  // Default: return generic message to avoid leaking internal details
  return 'An unexpected error occurred';
}
