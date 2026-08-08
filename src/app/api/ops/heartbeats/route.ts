import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { runHeartbeatSweep, getHeartbeats } from '@/lib/draymond/heartbeat';

export const dynamic = 'force-dynamic';

/** GET /api/ops/heartbeats — latest recorded agent heartbeats */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const heartbeats = await getHeartbeats();
    return NextResponse.json({ heartbeats });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

/** POST /api/ops/heartbeats — run a heartbeat sweep now */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const sweep = await runHeartbeatSweep();
    return NextResponse.json(sweep);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
