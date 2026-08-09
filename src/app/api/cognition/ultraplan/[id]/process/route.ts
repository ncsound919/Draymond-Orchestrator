import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { processUltraplan } from '@/lib/draymond/ultraplan';

export const dynamic = 'force-dynamic';

/** POST /api/cognition/ultraplan/[id]/process — run the deep lane now */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await processUltraplan(id));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'process failed' }, { status: 409 });
  }
}
