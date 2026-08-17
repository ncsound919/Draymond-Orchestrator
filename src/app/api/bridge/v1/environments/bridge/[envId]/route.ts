// ============================================================================
// DELETE /api/bridge/v1/environments/bridge/[envId] — Deregister environment
// ============================================================================
// Removes the environment on graceful worker shutdown.
//
// Auth: Bearer <environment_secret>.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getBridgeStore } from '@/lib/draymond/bridge-singleton';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ envId: string }> },
) {
  const { envId } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(envId)) {
    return NextResponse.json({ error: 'Invalid environment id' }, { status: 400 });
  }
  const authHeader = request.headers.get('authorization');
  const secret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const store = await getBridgeStore();
  const ok = store.deregister(envId, secret);
  if (!ok) {
    return NextResponse.json({ error: 'Environment not found or secret mismatch' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
