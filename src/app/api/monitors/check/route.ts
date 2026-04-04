/**
 * GET /api/monitors/check — Run checkAllSites() for all enabled monitors.
 *
 * Protected by CRON_SECRET — pass via Authorization: Bearer <secret> header.
 * Intended to be called by a cron job (e.g. Vercel Cron, GitHub Actions).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkAllSites } from '@/lib/draymond/monitors';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Authenticate via CRON_SECRET
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await checkAllSites();

    return NextResponse.json(results);
  } catch (err) {
    console.error('[api/monitors/check] GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to run site checks' },
      { status: 500 }
    );
  }
}
