import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { TidEngine } from '@/lib/draymond/tid-engine';
import type { TidDiscoveryStatus, TidActionType } from '@/lib/draymond/tid-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/tid/discoveries — dispatched/measured TID discoveries.
 *
 * Read-only surface over `tid_discoveries` so fleet peers can see which actions
 * Draymond promoted and what they produced. Query:
 *   status, actionType, limit (default 50, max 500).
 * Auth: Bearer CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const sp = request.nextUrl.searchParams;
    const limit = Math.max(1, Math.min(500, Number(sp.get('limit')) || 50));
    const discoveries = await TidEngine.listDiscoveries({
      status: (sp.get('status') as TidDiscoveryStatus) || undefined,
      actionType: (sp.get('actionType') as TidActionType) || undefined,
      limit,
    });
    return NextResponse.json({ ok: true, count: discoveries.length, discoveries });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
