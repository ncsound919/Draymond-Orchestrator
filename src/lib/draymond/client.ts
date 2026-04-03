// ============================================================================
// DRAYMOND — Supabase Client Helper
// Uses untyped Supabase client for Draymond-specific tables
// (The main Database type covers profiles/posts/etc. Draymond tables
//  are added via migration 004 and typed separately here.)
// ============================================================================

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * Create a Supabase client without the strict Database generic.
 * This allows querying the Draymond tables that aren't in the main Database type.
 * Validates required env vars at call time to provide clear error messages.
 *
 * Uses the anon key + SSR cookie store — subject to Row Level Security.
 * Use `createDraymondAdminClient()` for server-side admin operations.
 */
export async function createDraymondClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('[Draymond] Missing required env var: NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!supabaseAnonKey) {
    throw new Error('[Draymond] Missing required env var: NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const cookieStore = await cookies();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createServerClient<any>(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
            );
          } catch {
            // Server Component - read only
          }
        },
      },
    }
  );
}

/**
 * Create a Supabase admin client using the service role key.
 * This client BYPASSES Row Level Security — use only in trusted server-side
 * code (API routes, seed scripts, admin operations).
 *
 * Never expose this client to the browser or use in client components.
 */
export function createDraymondAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('[Draymond] Missing required env var: NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!serviceRoleKey) {
    throw new Error('[Draymond] Missing required env var: SUPABASE_SERVICE_ROLE_KEY');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: {
      // Disable auto-refresh and session persistence for server-side admin use
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
