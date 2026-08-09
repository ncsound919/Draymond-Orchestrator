import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { approveUltraplan } from '@/lib/draymond/ultraplan';

export const dynamic = 'force-dynamic';

/** POST /api/cognition/ultraplan/[id]/approve — approve a plan_ready ultraplan */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await approveUltraplan(id));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'approve failed' }, { status: 409 });
  }
}
