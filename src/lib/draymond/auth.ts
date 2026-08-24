import { getCurrentUser } from '@/lib/db/session';

/**
 * Verify the request is from an authenticated admin user.
 * Returns the user if authenticated and admin, or a Response object to return immediately.
 *
 * The old implementation checked `profiles.role === 'admin'` via Supabase.
 * The local equivalent checks the `role` column on the local_users row bound
 * to the session cookie.
 */
export async function requireDraymondAuth(): Promise<
  { user: { id: string; email?: string }; error?: never } | { user?: never; error: Response }
> {
  try {
    // Explicit opt-in bypass for local manual development only.
    // Unit tests must NOT set this variable so they exercise real auth paths.
    if (process.env.ALLOW_INSECURE_DEV_AUTH === 'true') {
      return { user: { id: 'local-dev-admin', email: 'admin@localhost' } };
    }

    const user = await getCurrentUser();

    if (!user) {
      return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    if (user.role !== 'admin') {
      return { error: Response.json({ error: 'Forbidden: admin access required' }, { status: 403 }) };
    }

    return { user: { id: user.id, email: user.email } };
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
