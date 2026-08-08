import { NextResponse } from 'next/server';
import { isKaggleConfigured, kaggleStatus } from '@/lib/draymond/data-apis';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/kaggle/status — minimal, UNAUTHENTICATED health probe for the
 * "Kaggle Integration" site monitor (site monitors can't send a Bearer token).
 * Returns only configured yes/no + ok — never the key, never the username.
 * Non-200 when unconfigured/unhealthy so the monitor reflects real status.
 */
export async function GET() {
  try {
    const configured = isKaggleConfigured();
    const status = configured ? await kaggleStatus().catch(() => ({ ok: false, detail: 'probe failed' })) : null;
    const ok = configured && status?.ok === true;
    return NextResponse.json({ ok, configured, detail: status?.detail ?? (configured ? 'unverified' : 'not configured') }, { status: ok ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, configured: false }, { status: 503 });
  }
}
