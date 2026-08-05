/**
 * Proxy (Next.js 16 — renamed from middleware)
 *
 * Guards the dashboard pages behind a Supabase session + purchase check.
 * `/api/*` is intentionally EXCLUDED from the matcher: API routes are
 * protected solely by per-route `authorizeRequest` (CRON_SECRET Bearer /
 * per-action review tokens), so the ntfy approve/reject callbacks and the
 * Open-Chat / Hermes integrations can authenticate without a browser session.
 *
 * Purchase gate: calls `user_has_access(p_user_id, p_entity_slug)`. If that
 * RPC does not exist yet in the database, we FAIL OPEN (log + allow) rather
 * than bricking the dashboard for every logged-in user.
 */
import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options: CookieOptions }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 1. Check for active session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public paths that don't need access gating
  const isAuthPath = request.nextUrl.pathname.startsWith('/auth');
  const isStaticPath = request.nextUrl.pathname.match(/\.(.*)$/);

  if (isAuthPath || isStaticPath) {
    return response;
  }

  // Marketing site URL for redirects
  const MARKETING_SITE_URL = 'https://theupliftlab.com/tools/draymond-orchestrator';

  // 2. If no user, redirect to login or marketing with error
  if (!user) {
    return NextResponse.redirect(`${MARKETING_SITE_URL}?error=login_required`);
  }

  // 3. Verify purchase for 'draymond-orchestrator'
  // Uses user_has_access(p_user_id, p_entity_slug). The RPC is defined in
  // Supabase; if it is missing, fail OPEN (log + allow) so the dashboard stays
  // usable — do NOT redirect every logged-in user to the marketing site.
  const { data: hasAccess, error: accessError } = await supabase.rpc(
    'user_has_access',
    {
      p_user_id: user.id,
      p_entity_slug: 'draymond-orchestrator',
    }
  );

  if (accessError) {
    console.warn(
      `[Proxy] user_has_access RPC unavailable (failing open): ${accessError.message}`
    );
    return response;
  }

  if (!hasAccess) {
    return NextResponse.redirect(`${MARKETING_SITE_URL}?error=access_denied`);
  }

  return response;
}

export const config = {
  /*
   * Pages only — /api/* is excluded so per-route authorizeRequest owns API
   * auth (CRON_SECRET Bearer / X-Review-Token). Also skip static assets,
   * _next/* and image-optimization paths.
   */
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
