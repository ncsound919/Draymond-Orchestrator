import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/marketing
 * Body: { problem?: string, channels?: Array<{id,name,platform,description}>, campaigns?: Array<{id,title,channel,description}> }
 * Returns: Dev-Brain weighted marketing mix + guard.
 *
 * Auth: Bearer CRON_SECRET. Deterministic (no LLM) via Dev-Brain.
 */
export async function POST(req: NextRequest) {
  const auth = authorizeRequest(req);
  if (auth) return auth;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  try {
    const { decideMarketingMix } = await import('@/lib/draymond/marketing-decision');
    const decision = await decideMarketingMix({
      problem: body.problem as string | undefined,
      channels: body.channels as never,
      campaigns: body.campaigns as never,
      strategyKey: body.strategy as never,
    });
    return NextResponse.json({ ok: true, ...decision });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const auth = authorizeRequest(req);
  if (auth) return auth;
  try {
    const { defaultMarketingMix } = await import('@/lib/draymond/marketing-decision');
    const decision = await defaultMarketingMix();
    return NextResponse.json({ ok: true, ...decision });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
