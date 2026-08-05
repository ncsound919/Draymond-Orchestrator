'use server';

/**
 * Server-side quick-action proxy for the operations dashboard.
 *
 * The client never sees CRON_SECRET: buttons call this action, which attaches
 * the server-side secret and invokes the internal admin API route. This
 * closes the previous leak where NEXT_PUBLIC_CRON_SECRET was shipped in the
 * client bundle and anyone could call /api/cron, /api/seed, etc.
 */
export async function runQuickAction(endpoint: string, method: 'GET' | 'POST'): Promise<{ ok: boolean; status: number }> {
  const secret = process.env.CRON_SECRET;
  const baseUrl = process.env.DRAYMOND_INTERNAL_URL || '';
  if (!secret) {
    return { ok: false, status: 503 };
  }

  // Only allow a known set of internal admin endpoints.
  const allowed = new Set([
    '/api/cron',
    '/api/monitors/check',
    '/api/notifications/test',
    '/api/seed',
  ]);
  if (!allowed.has(endpoint)) {
    return { ok: false, status: 403 };
  }

  try {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: method === 'GET' ? undefined : JSON.stringify({}),
      cache: 'no-store',
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 500 };
  }
}
