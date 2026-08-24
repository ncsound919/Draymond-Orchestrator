import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/brain/task
 * Send an ad-hoc task to the deterministic brain's zero-LLM loop. Paper-intent
 * queries are routed to /research/publish automatically by runBrainTask.
 *
 * Body: { query: string, lane?: string }
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    query?: string;
    lane?: string;
  }>(request);
  if (parseError) return parseError;

  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return NextResponse.json({ ok: false, error: 'query is required' }, { status: 400 });
  }

  const { runBrainTask } = await import('@/lib/draymond/brain-task');
  const output = await runBrainTask(query, { lane: body?.lane ?? undefined });

  if (output === null) {
    return NextResponse.json(
      { ok: false, error: 'Brain unreachable or unconfigured (BRAIN_URL)' },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, output });
}
