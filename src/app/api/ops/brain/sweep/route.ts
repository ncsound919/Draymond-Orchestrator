import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ops/brain/sweep
 * Trigger a bounded deterministic-brain sweep (Recognition → Labeling →
 * Intervention). Returns the run report or an error flag when the brain is
 * unconfigured / unreachable.
 *
 * Body: { mode?, scope?, community?, maxFindings? }
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    mode?: string;
    scope?: string;
    community?: string;
    maxFindings?: number;
  }>(request);
  if (parseError) return parseError;

  const { runBrainSweep } = await import('@/lib/draymond/brain-client');
  const result = await runBrainSweep({
    mode: body?.mode ?? 'manual',
    scope: body?.scope ?? 'all',
    community: body?.community ?? undefined,
    maxFindings: body?.maxFindings ?? 20,
  });

  if (!result) {
    return NextResponse.json(
      { ok: false, error: 'Brain unreachable or unconfigured (BRAIN_URL)' },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, report: result });
}
