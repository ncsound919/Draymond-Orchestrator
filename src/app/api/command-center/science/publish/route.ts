// ============================================================================
// /api/command-center/science — Command Center science helpers
// ============================================================================
// GET  /api/command-center/science/publish — status (unused; GET kept minimal)
// POST /api/command-center/science/publish — trigger a Global Lens paper publish
//       via the deterministic brain bridge (runBrainTask routes research-paper
//       intents to /research/publish).
//   Body: { topic: string, timeout_ms?: number }
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { runBrainTask, isBrainTaskConfigured } from '@/lib/draymond/brain-task';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    return NextResponse.json({
      ok: true,
      brainConfigured: isBrainTaskConfigured(),
      endpoint: 'POST /api/command-center/science/publish { topic }',
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const { data: body, error: parseError } = await parseJsonBody<{
    topic?: string;
    timeout_ms?: number;
  }>(request);
  if (parseError) return parseError;

  try {
    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    if (!topic) {
      return NextResponse.json(
        { ok: false, error: 'topic is required' },
        { status: 400 },
      );
    }
    if (!isBrainTaskConfigured()) {
      return NextResponse.json(
        { ok: false, error: 'Deterministic brain not configured (BRAIN_URL missing)' },
        { status: 503 },
      );
    }
    const output = await runBrainTask(topic, { timeoutMs: body.timeout_ms });
    if (output === null) {
      return NextResponse.json(
        { ok: false, error: 'Brain publish failed or timed out' },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, output });
  } catch (err) {
    console.error('[api/command-center/science] POST', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
