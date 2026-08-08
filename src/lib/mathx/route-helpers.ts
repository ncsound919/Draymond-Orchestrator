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

/** Read a JSON body with a hard size guard (mirrors api-auth.parseJsonBody). */
export async function readJson<T>(
  request: NextRequest,
  maxBytes = 1_048_576,
): Promise<{ data: T; error?: never } | { data?: never; error: NextResponse }> {
  const contentLength = parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { error: NextResponse.json({ error: 'Request body too large' }, { status: 413 }) };
  }
  try {
    const text = await request.text();
    if (text.length > maxBytes) {
      return { error: NextResponse.json({ error: 'Request body too large' }, { status: 413 }) };
    }
    const data = JSON.parse(text) as T;
    return { data };
  } catch {
    return { error: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }
}

/** Uniform 500 shape that never leaks internals.
 *  Known config/availability problems keep their actionable message. */
export function mathErrorResponse(err: unknown): NextResponse {
  console.error('[math] route error:', err);
  const raw = err instanceof Error ? err.message : String(err);
  const actionable =
    /no llm|api key|vision|provider|unreachable|not configured|timed out|timeout/i.test(raw) &&
    raw.length < 300;
  const message = actionable ? raw : sanitizeError(err);
  return NextResponse.json({ error: message }, { status: 500 });
}
