// ============================================================================
// /api/chains/[id]/execute — Instantiate & execute a chain template
// ============================================================================
// POST — Instantiate the given chain template and execute the resulting
//        instance. Returns the execution context on completion.
//
// Body (all optional):
//   { agent_id?: string, input?: Record<string, unknown>, timeout_ms?: number }
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { instantiateChain, executeChain } from '@/lib/draymond/chains';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

// Max timeout to prevent resource exhaustion (5 minutes)
const MAX_TIMEOUT_MS = 300_000;

// ── POST /api/chains/[id]/execute ───────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    // Parse optional body — an empty body is valid
    let agent_id: string | undefined;
    let input: Record<string, unknown> = {};
    let timeout_ms: number | undefined;

    try {
      const body = await request.json();
      agent_id = typeof body.agent_id === 'string' ? body.agent_id : undefined;
      input = body.input && typeof body.input === 'object' ? body.input : {};
      if (typeof body.timeout_ms === 'number') {
        timeout_ms = Math.max(0, Math.min(MAX_TIMEOUT_MS, body.timeout_ms));
      }
    } catch {
      // Empty or non-JSON body — use defaults
    }

    // Instantiate a runnable copy from the template
    const instance = await instantiateChain(id, input, undefined, agent_id);

    // Execute the instance
    const context = await executeChain(instance.id, agent_id, { timeout_ms });

    return NextResponse.json({
      ok: true,
      chain_id: instance.id,
      result: context,
    });
  } catch (err) {
    console.error('[API /api/chains/[id]/execute POST]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
