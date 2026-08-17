// ============================================================================
// POST /api/bridge/v1/environments/[envId]/work/[workId]/stop — Force-stop
// ============================================================================
// Marks the work item as interrupted (hard-kill) or requests a graceful stop.
// Body (JSON): { force?: boolean }
//
// Auth: Bearer <session_ingress_token> or <environment_secret>.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getBridgeStore } from '@/lib/draymond/bridge-singleton';
import { parseJsonBody } from '@/lib/draymond/api-auth';

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

  const parsed = await parseJsonBody<{ force?: unknown }>(request);
  const force = parsed.data && !('error' in parsed) ? parsed.data.force === true : false;

  const store = await getBridgeStore();
  const ok = store.stopWork(envId, workId, token, force);
  if (!ok) {
    return NextResponse.json({ error: 'Work item not found or token mismatch' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
