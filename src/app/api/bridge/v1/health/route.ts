// ============================================================================
// GET /api/bridge/v1/health — Bridge health + status snapshot
// ============================================================================
// Lightweight health probe for the bridge work queue. Returns counts so
// operators can see live environments / sessions / work items.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getBridgeStore } from '@/lib/draymond/bridge-singleton';
import { getCurrentUser } from '@/lib/db/session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const bearer = request.headers.get('authorization');
  const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : '';
  const cronSecret = process.env.CRON_SECRET;
  const cronOk = Boolean(cronSecret) && token === cronSecret;
  const user = cronOk ? null : await getCurrentUser();

  if (!cronOk && !user) {
    // Anonymous callers get liveness only — never the fleet snapshot.
    return NextResponse.json({ ok: true, status: 'up' });
  }

  const store = await getBridgeStore();
  const snapshot = store.snapshot();
  return NextResponse.json({ ok: true, status: 'up', ...snapshot });
}
