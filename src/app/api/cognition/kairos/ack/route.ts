import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { ackMoment } from '@/lib/draymond/kairos';

export const dynamic = 'force-dynamic';

/** POST /api/cognition/kairos/ack { id } — acknowledge a moment */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const ok = await ackMoment(id);
  if (!ok) return NextResponse.json({ error: 'moment not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
