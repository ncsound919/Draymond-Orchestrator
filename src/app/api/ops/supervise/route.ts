import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { bigHomieGate } from '@/lib/draymond/supervisor';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/supervise — Big Homie quality gate.
 * { agentId, task, output, requires?: string[] } → approved + reasons.
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.agentId !== 'string' || typeof body.task !== 'string' || typeof body.output !== 'string') {
    return NextResponse.json({ error: 'agentId, task, output are required' }, { status: 400 });
  }
  const verdict = await bigHomieGate(
    body.agentId,
    body.task,
    body.output,
    Array.isArray(body.requires) ? body.requires.map(String) : undefined,
  );
  return NextResponse.json(verdict, { status: verdict.approved ? 200 : 202 });
}
