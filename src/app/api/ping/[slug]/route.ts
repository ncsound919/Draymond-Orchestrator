import { NextRequest, NextResponse } from 'next/server';
import {
  recordServicePing,
  recordServiceFailure,
  getGateSnapshot,
} from '@/lib/draymond/repair-gate';

export const dynamic = 'force-dynamic';

/**
 * Dead-man-switch ping endpoint for the repair verification gate (S9).
 * POST /api/ping/:slug        — one healthy observation
 * POST /api/ping/:slug?fail=1 — one failed observation (resets streak)
 * GET  /api/ping/:slug        — gate status for the slug
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const fail = req.nextUrl.searchParams.get('fail') === '1';
  const entry = fail ? recordServiceFailure(slug) : recordServicePing(slug);
  if (!entry) return NextResponse.json({ error: 'unknown slug' }, { status: 404 });
  return NextResponse.json({ ok: true, entry });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const snapshot = getGateSnapshot();
  const entry = snapshot.entries[slug];
  if (!entry) return NextResponse.json({ error: 'unknown slug' }, { status: 404 });
  return NextResponse.json({ ok: true, entry });
}
