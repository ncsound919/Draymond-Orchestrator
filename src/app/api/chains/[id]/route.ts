// ============================================================================
// /api/chains/[id] — Single-chain operations (get & delete)
// ============================================================================
// GET    — Retrieve a chain by ID or slug
// DELETE — Delete a chain (and its steps via cascade)
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getChain, deleteChain } from '@/lib/draymond/chains';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

// ── GET /api/chains/[id] ────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const chain = await getChain(id);

    if (!chain) {
      return NextResponse.json({ ok: false, error: 'Chain not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, chain });
  } catch (err) {
    console.error('[API /api/chains/[id] GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// ── DELETE /api/chains/[id] ─────────────────────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    await deleteChain(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[API /api/chains/[id] DELETE]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
