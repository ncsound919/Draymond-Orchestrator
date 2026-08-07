import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { canCallProvider, laneStatus, laneSnapshot, resetBudget, consumeTokens } from '@/lib/draymond/workflow-budget';

export const dynamic = 'force-dynamic';

const PROVIDERS = ['opencode-free', 'opencode', 'deepseek', 'gemini', 'openai', 'anthropic', 'qwen', 'litellm'];

/** GET /api/ops/budget — provider budget/rate health + task-lane status */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const providers = PROVIDERS.map((p) => ({ provider: p, ...canCallProvider(p) }));
  return NextResponse.json({ providers, lanes: laneSnapshot() });
}

/** POST /api/ops/budget — { agentId } lane status; or { reset: true } to reset */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.reset === true) {
    resetBudget();
    return NextResponse.json({ reset: true });
  }
  if (typeof body.agentId === 'string') {
    return NextResponse.json({ agentId: body.agentId, lane: laneStatus(body.agentId) });
  }
  return NextResponse.json({ error: 'send { reset: true } or { agentId }' }, { status: 400 });
}
