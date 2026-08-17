// ============================================================================
// POST /api/bridge/v1/environments/[envId]/work/[workId]/heartbeat — Lease
// ============================================================================
// Extends the work item lease so the server knows the worker is alive. A
// terminal session state (completed/failed/interrupted) is reported back so
// the worker can stop heartbeating.
//
// Auth: Bearer <session_ingress_token>.
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
  const result = store.heartbeatWork(envId, workId, token);
  if (!result) {
    return NextResponse.json({ error: 'Work item not found or token mismatch' }, { status: 404 });
  }
  return NextResponse.json({ ...result, ok: true });
}
