import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { getLessons, recordOutcome } from '@/lib/draymond/self-learning';

export const dynamic = 'force-dynamic';

/** GET /api/ops/learning?agentId=... — distilled lessons */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const agentId = new URL(request.url).searchParams.get('agentId') ?? undefined;
  return NextResponse.json({ lessons: await getLessons(agentId) });
}

/** POST /api/ops/learning — record an outcome { agentId, kind, summary, success, detail } */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { agentId, kind, summary, success, detail } = body;
  if (typeof agentId !== 'string' || typeof summary !== 'string' || typeof success !== 'boolean') {
    return NextResponse.json({ error: 'agentId, summary, success are required' }, { status: 400 });
  }
  const outcome = await recordOutcome({
    agentId,
    kind: (kind as never) ?? 'manual',
    summary,
    success,
    detail: typeof detail === 'string' ? detail : '',
  });
  return NextResponse.json(outcome, { status: 201 });
}
