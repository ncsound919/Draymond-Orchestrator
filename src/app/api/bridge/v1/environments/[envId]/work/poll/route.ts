// ============================================================================
// GET /api/bridge/v1/environments/[envId]/work/poll — Poll for work
// ============================================================================
// Returns the next queued/in-progress work item for the environment, or
// `{ data: null }` when idle. The worker acks the returned item; before the
// ack it stays claimable so a reconnect re-claims the same work.
//
// Auth: Bearer <environment_secret> (the secret issued at registration).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getBridgeStore } from '@/lib/draymond/bridge-singleton';

export const dynamic = 'force-dynamic';

export async function GET(
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
  const work = store.pollForWork(envId, secret);
  if (!work) {
    return NextResponse.json({ data: null, ok: true });
  }
  return NextResponse.json({ ...work, ok: true });
}
