import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { replanUltraplan } from '@/lib/draymond/ultraplan';

export const dynamic = 'force-dynamic';

/** POST /api/cognition/ultraplan/[id]/replan { brief } — edit + re-queue */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const brief = typeof body.brief === 'string' ? body.brief : '';
  if (!brief) return NextResponse.json({ error: 'brief is required' }, { status: 400 });
  try {
    return NextResponse.json(await replanUltraplan(id, brief));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'replan failed' }, { status: 409 });
  }
}
