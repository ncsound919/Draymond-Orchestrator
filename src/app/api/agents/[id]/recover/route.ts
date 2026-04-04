// ============================================================================
// POST /api/agents/:id/recover — Initiate Agent Recovery
// ============================================================================
// Triggers the Draymond recovery protocol for a specific agent. If the agent
// has a fallback configured, a handoff is initiated. Otherwise, if auto-
// recovery is enabled, the agent's error state is reset.
//
// Protected by CRON_SECRET — the caller must send:
//   Authorization: Bearer <CRON_SECRET>
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { initiateRecovery } from '@/lib/draymond/index';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  // ── Parse params & body ─────────────────────────────────────────────
  const { id } = await params;

  let sessionId: string | undefined;

  try {
    const body = (await request.json()) as { session_id?: string };
    sessionId = typeof body.session_id === 'string' ? body.session_id : undefined;
  } catch {
    // Empty or non-JSON body is acceptable — session_id is optional
  }

  // ── Initiate recovery ───────────────────────────────────────────────
  try {
    const result = await initiateRecovery(id, sessionId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[API /agents/:id/recover]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
