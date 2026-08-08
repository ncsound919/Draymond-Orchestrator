import { NextResponse } from 'next/server';
import { requireMathAuth } from '@/lib/mathx/route-helpers';
import { probeMathModels } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

/** GET /api/math/models — provider availability probe. */
export async function GET() {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const result = await probeMathModels();
  return NextResponse.json(result);
}
