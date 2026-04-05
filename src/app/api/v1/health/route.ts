/**
 * GET /api/v1/health
 * Open-Chat companion health endpoint.
 * Returns orchestrator status so the phone app can show a connection indicator.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'draymond-orchestrator',
    checked_at: new Date().toISOString(),
  });
}
