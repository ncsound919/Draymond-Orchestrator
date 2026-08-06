import { createClient } from '@/lib/supabase/server';

/**
 * Verify the request is from an authenticated admin user.
 * Returns the user if authenticated and admin, or a Response object to return immediately.
 *
 * Mirrors the admin check in src/app/admin/draymond/page.tsx:
 *   profiles.role === 'admin'
 */
export async function requireDraymondAuth(): Promise<
  { user: { id: string; email?: string }; error?: never } | { user?: never; error: Response }
> {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    // Check admin role — matches the pattern in the admin page
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
    const sb = supabase as any;

    const { data: profile } = await sb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single() as { data: { role: string } | null };

    if (!profile || profile.role !== 'admin') {
      return { error: Response.json({ error: 'Forbidden: admin access required' }, { status: 403 }) };
    }

    return { user: { id: user.id, email: user.email ?? undefined } };
  } catch {
    return { error: Response.json({ error: 'Authentication failed' }, { status: 500 }) };
  }
}

/**
 * Server-action variant of requireDraymondAuth: returns the user or throws,
 * so 'use server' actions can guard privileged operations with a single call.
 */
export async function requireDraymondActionAuth(): Promise<{ id: string; email?: string }> {
  const result = await requireDraymondAuth();
  if (result.error) {
    throw new Error('Unauthorized: admin access required');
  }
  return result.user;
}
