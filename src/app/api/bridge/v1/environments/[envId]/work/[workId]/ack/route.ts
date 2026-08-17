// ============================================================================
// POST /api/bridge/v1/environments/[envId]/work/[workId]/ack — Ack a work item
// ============================================================================
// Marks a queued work item as in-progress (leased to the worker). Uses the
// session ingress token once a session is established, else the environment
// secret — matching the bridge worker's ack behavior.
//
// Auth: Bearer <session_ingress_token> or <environment_secret>.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getBridgeStore } from '@/lib/draymond/bridge-singleton';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ envId: string; workId: string }> },
) {
  const { envId, workId } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(envId) || !/^[a-zA-Z0-9_-]+$/.test(workId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const store = await getBridgeStore();
  const ok = store.ackWork(envId, workId, token);
  if (!ok) {
    return NextResponse.json({ error: 'Work item not found or token mismatch' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
