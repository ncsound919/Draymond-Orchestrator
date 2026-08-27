// ============================================================================
// Shared API Authentication — CRON_SECRET Bearer Token
// ============================================================================
// Single source of truth for all Draymond API route authentication.
// Uses timing-safe string comparison to prevent timing attacks.
// Returns generic error messages to avoid leaking server configuration.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

/** Maximum request body size (1 MB). */
const MAX_BODY_BYTES = 1_048_576;

/**
 * Timing-safe string comparison.
 * Always runs timingSafeEqual regardless of length mismatch to avoid
 * leaking length information through timing side-channels.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Pad the shorter buffer so timingSafeEqual always executes over the same length
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  // Both the constant-time compare AND the length check must pass
  return timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
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
export function authorizeRequest(request: NextRequest | Request): NextResponse | null {
  // Explicit opt-in bypass for local manual development only.
  // Tests must NOT set this variable — they exercise the real auth path.
  // Hard-gated to non-production: this app is tunneled publicly, and this
  // bypass disables ALL API auth. It must never fire on a deployed instance.
  if (
    process.env.ALLOW_INSECURE_DEV_AUTH === 'true' &&
    process.env.NODE_ENV !== 'production'
  ) {
    console.warn('[API Auth] ALLOW_INSECURE_DEV_AUTH bypass active (non-production only)');
    return null;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
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
 * Authorize a Prometheus scrape for /api/ops/metrics.
 * Accepts a dedicated METRICS_TOKEN when set, otherwise falls back to the
 * CRON_SECRET. Returns `null` when authorized, else a NextResponse error.
 */
export function authorizeMetricsRequest(request: NextRequest | Request): NextResponse | null {
  const token = process.env.METRICS_TOKEN || process.env.CRON_SECRET;
  if (!token) {
    console.error('[API Auth] METRICS_TOKEN / CRON_SECRET env var is not set');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!bearer || !safeCompare(bearer, token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null; // authorized
}

/**
 * Safely parse JSON from a request body.
 * Enforces a maximum body size to prevent memory exhaustion.
 * Returns `{ data }` on success or `{ error: NextResponse }` on failure.
 */
export async function parseJsonBody<T = unknown>(
  request: NextRequest,
): Promise<{ data: T; error?: never } | { data?: never; error: NextResponse }> {
  try {
    // Check Content-Length if provided (fast reject for obviously oversized bodies)
    const contentLength = parseInt(request.headers.get('content-length') ?? '', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return {
        error: NextResponse.json(
          { error: 'Request body too large' },
          { status: 413 },
        ),
      };
    }

    // Read the body as text first so we can enforce size limits
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return {
        error: NextResponse.json(
          { error: 'Request body too large' },
          { status: 413 },
        ),
      };
    }

    const data = JSON.parse(text) as T;
    return { data };
  } catch {
    return {
      error: NextResponse.json(
        { error: 'Invalid JSON body' },
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

// ── ID validation ────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true if `id` is a valid UUID v4 format. */
export function isValidUuid(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * Validate that a string looks like a safe identifier (UUID, slug, or short alphanum).
 * Blocks injection attempts — only allows alphanumeric, hyphens, underscores, dots.
 */
const SAFE_ID_RE = /^[a-zA-Z0-9_.-]{1,128}$/;

export function isValidId(id: string): boolean {
  return SAFE_ID_RE.test(id);
}

/**
 * Returns a 400 NextResponse if any of the given IDs fail the UUID format check.
 * Returns `null` if all IDs are valid (or undefined/empty — those are skipped).
 *
 * Usage:
 * ```ts
 * const badId = requireValidIds({ entity_id: entityId, agent_id: agentId });
 * if (badId) return badId;
 * ```
 */
export function requireValidIds(
  ids: Record<string, string | null | undefined>,
): NextResponse | null {
  for (const [name, value] of Object.entries(ids)) {
    if (value == null || value === '') continue;
    if (!isValidId(value)) {
      return NextResponse.json(
        { error: `Invalid ${name} format` },
        { status: 400 },
      );
    }
  }
  return null;
}
