import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { rejectUltraplan } from '@/lib/draymond/ultraplan';

export const dynamic = 'force-dynamic';

/** POST /api/cognition/ultraplan/[id]/reject — reject a plan_ready ultraplan */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await rejectUltraplan(id));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'reject failed' }, { status: 409 });
  }
}
