import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { TidEngine } from '@/lib/draymond/tid-engine';
import type { TidSignalSource, TidSignalCategory } from '@/lib/draymond/tid-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/tid/signals — recent Trends/Insights/Discoveries signals.
 *
 * Read-only surface over `tid_signals` so fleet peers (e.g. Recourse) can run
 * their own deterministic analysis on Draymond's operational history. Query:
 *   source, category, component, metric, limit (default 200, max 1000).
 * Auth: Bearer CRON_SECRET (see `authorizeRequest`).
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const sp = request.nextUrl.searchParams;
    const limit = Math.max(1, Math.min(1000, Number(sp.get('limit')) || 200));
    const signals = await TidEngine.listSignals({
      source: (sp.get('source') as TidSignalSource) || undefined,
      category: (sp.get('category') as TidSignalCategory) || undefined,
      component: sp.get('component') || undefined,
      metric: sp.get('metric') || undefined,
      limit,
    });
    return NextResponse.json({ ok: true, count: signals.length, signals });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
