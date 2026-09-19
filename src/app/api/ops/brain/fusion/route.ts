import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/brain/fusion
 * Body: { problem: string, candidates?: Array<{id,title,description,tags}>, strategy?: string }
 * Fans to BOTH brains (Dev-Brain 3450 + deterministic brain 3210) and merges.
 * Never throws; always returns a fused decision even if one brain is down.
 */
export async function POST(req: NextRequest) {
  const auth = authorizeRequest(req);
  if (auth) return auth;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const problem = typeof body.problem === 'string' ? body.problem : null;
  if (!problem) return NextResponse.json({ error: 'problem is required' }, { status: 400 });

  try {
    const { runBrainFusion } = await import('@/lib/draymond/brain-fusion');
    const fusion = await runBrainFusion({
      problem,
      candidates: (body.candidates as never) ?? [],
      strategy: body.strategy as never,
    });
    return NextResponse.json({ ok: true, fusion });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const auth = authorizeRequest(req);
  if (auth) return auth;
  // Health probe: are both brains reachable?
  try {
    const { devBrainReachable } = await import('@/lib/draymond/dev-brain');
    const { isBrainConfigured } = await import('@/lib/draymond/brain-client');
    const [devUp, brainConfigured] = await Promise.all([devBrainReachable(), Promise.resolve(isBrainConfigured())]);
    return NextResponse.json({ ok: true, devBrain: devUp, deterministicBrain: brainConfigured });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
