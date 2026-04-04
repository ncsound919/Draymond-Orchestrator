import { NextRequest, NextResponse } from 'next/server';
import { pingUplift } from '@/lib/uplift';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const alive = await pingUplift();
  return NextResponse.json({
    uplift_online: alive,
    checked_at: new Date().toISOString(),
  }, { status: alive ? 200 : 503 });
}
