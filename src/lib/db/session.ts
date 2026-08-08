// ============================================================================
// Session helpers for Next.js (proxy + route handlers + server components)
// ============================================================================

import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, getUserBySessionToken, type LocalUser } from './auth';

/** Resolve the current user from the session cookie (proxy / edge context). */
export function getSessionUserFromRequest(request: NextRequest): LocalUser | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return getUserBySessionToken(token);
}

/** Resolve the current user from the cookie store (routes / server components). */
export async function getCurrentUser(): Promise<LocalUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return getUserBySessionToken(token);
}

/**
 * Set the session cookie on a response. The `secure` flag mirrors the actual
 * request protocol so local/Electron installs (plain http://localhost) still
 * get a usable cookie — a Secure cookie would be rejected by the browser over
 * http. Pass `true` only when serving over https.
 */
export function setSessionCookie(
  response: NextResponse,
  token: string,
  secure = false
): NextResponse {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
