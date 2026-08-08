// ============================================================================
// Shared helpers for the /api/math/* route group.
// Auth follows the browser-facing pattern (/api/chat): local admin session.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireDraymondAuth } from '../draymond/auth';
import { sanitizeError } from '../draymond/api-auth';

export async function requireMathAuth(): Promise<
  | { user: { id: string; email?: string }; error?: never }
  | { user?: never; error: Response }
> {
  return requireDraymondAuth();
}

/** Read a JSON body with a bounded size guard. */
export async function readJson<T>(
  request: NextRequest,
  maxBytes = 1_048_576,
): Promise<{ data: T; error?: never } | { data?: never; error: NextResponse }> {
  const contentLength = parseInt(request.headers.get('content-length') ?? '', 10);
  if (contentLength > maxBytes) {
    return { error: NextResponse.json({ error: 'Request body too large' }, { status: 413 }) };
  }
  try {
    const data = (await request.json()) as T;
    return { data };
  } catch {
    return { error: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }
}

/** Uniform 500 shape that never leaks internals. */
export function mathErrorResponse(err: unknown): NextResponse {
  console.error('[math] route error:', err);
  return NextResponse.json({ error: sanitizeError(err) }, { status: 500 });
}
