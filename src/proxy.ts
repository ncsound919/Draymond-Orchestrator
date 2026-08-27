/**
 * Proxy (Next.js 16 — renamed from middleware)
 *
 * Two responsibilities:
 *
 * 1. Guard dashboard pages behind a local admin session.
 * 2. Add permissive CORS to `/api/*` so mobile clients (Open-Chat on a phone
 *    WebView) and LAN tools can call the orchestrator. Every API route is
 *    protected by its own `authorizeRequest` (CRON_SECRET Bearer / review
 *    tokens), so a wide CORS origin does not weaken auth. Preflight OPTIONS
 *    is answered here (204) so browser clients with `Authorization` headers
 *    work from any origin.
 *
 * Supabase Auth + the `user_has_access` purchase gate are gone: this is a
 * private self-hosted instance, so the session check is the only page gate.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, getUserBySessionToken } from '@/lib/db/auth';

const CORS_ALLOW_HEADERS =
  'Authorization, Content-Type, X-Review-Token, X-Api-Key';
const CORS_EXPOSE_HEADERS = 'Content-Type';

function corsHeaders(requestOrigin?: string | null): Record<string, string> {
  const configured = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.trim()
    ? process.env.CORS_ORIGIN.trim()
    : '';
  // Reflect the caller's origin only when explicitly allowlisted; otherwise no
  // ACAO header at all (browsers block cross-origin reads; non-browser LAN
  // clients are unaffected). Never default to '*': this dashboard is tunneled
  // publicly and unauthenticated GET responses (health/registry/catalog) are
  // otherwise readable by any website the operator visits.
  const origin = configured === '*' ? '*' : configured;
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    'Access-Control-Expose-Headers': CORS_EXPOSE_HEADERS,
    'Access-Control-Max-Age': '86400',
  };
  if (origin && requestOrigin && (origin === '*' || origin === requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export async function proxy(request: NextRequest) {
  const isApiPath = request.nextUrl.pathname.startsWith('/api');

  // ── API: CORS + preflight ────────────────────────────────────────────────
  if (isApiPath) {
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: corsHeaders(request.headers.get('origin')),
      });
    }
    const response = NextResponse.next({
      request: { headers: request.headers },
    });
    for (const [key, value] of Object.entries(corsHeaders(request.headers.get('origin')))) {
      response.headers.set(key, value);
    }
    return response;
  }

  // ── Pages: session gate ───────────────────────────────────────────────────
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Public paths that don't need a session
  const isAuthPath = request.nextUrl.pathname.startsWith('/login');
  // Only known static asset extensions bypass the gate (avoid `/agents/foo.bar`).
  const isStaticPath = /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$/i.test(
    request.nextUrl.pathname
  );

  if (isAuthPath || isStaticPath) {
    return response;
  }

  // Check for an active local session
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = getUserBySessionToken(token);

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // API + everything else. The page gate below skips /api (handled above),
    // static assets, and _next/*.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
