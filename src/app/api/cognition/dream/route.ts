import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { dreamReport } from '@/lib/draymond/dream-cycle';

export const dynamic = 'force-dynamic';

/** GET /api/cognition/dream — latest dream report + state */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  return NextResponse.json(await dreamReport());
}
