// ============================================================================
// GET /api/bridge/v1/health — Bridge health + status snapshot
// ============================================================================
// Lightweight health probe for the bridge work queue. Returns counts so
// operators can see live environments / sessions / work items.
// ============================================================================

import { NextResponse } from 'next/server';
import { getBridgeStore } from '@/lib/draymond/bridge-singleton';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = await getBridgeStore();
  const snapshot = store.snapshot();
  return NextResponse.json({ ok: true, status: 'up', ...snapshot });
}
