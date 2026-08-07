import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { repairLog } from '@/lib/draymond/repair-team';

export const dynamic = 'force-dynamic';

/** GET /api/ops/repair-team — recent repair-team activity */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  return NextResponse.json({ log: await repairLog() });
}
