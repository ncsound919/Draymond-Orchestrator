import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { rdNightReport } from '@/lib/draymond/rd-night';

export const dynamic = 'force-dynamic';

/** GET /api/ops/rd-night — overnight R&D queue + brief */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  return NextResponse.json(await rdNightReport());
}
