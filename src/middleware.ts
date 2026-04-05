import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
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
  const isAuthPath = request.nextUrl.pathname.startsWith('/auth') || 
                    request.nextUrl.pathname.startsWith('/api/auth');
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
  // Uses user_has_access(p_user_id, p_entity_slug) from migration 008_purchases.sql
  const { data: hasAccess, error: accessError } = await supabase
    .rpc('user_has_access', {
      p_user_id: user.id,
      p_entity_slug: 'draymond-orchestrator',
    });

  if (accessError || !hasAccess) {
    console.warn(`Access denied for user ${user.id}:`, accessError);
    return NextResponse.redirect(`${MARKETING_SITE_URL}?error=access_denied`);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
