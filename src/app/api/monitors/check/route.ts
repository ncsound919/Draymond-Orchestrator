/**
 * GET /api/monitors/check — Run checkAllSites() for all enabled monitors.
 *
 * Protected by CRON_SECRET — pass via Authorization: Bearer <secret> header.
 * Intended to be called by a cron job (e.g. Vercel Cron, GitHub Actions).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkAllSites } from '@/lib/draymond/monitors';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

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
