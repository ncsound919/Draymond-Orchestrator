import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { listRegistrations } from '@/lib/music-rights';

export const dynamic = 'force-dynamic';

/**
 * GET /api/music/registrations
 * List recent music-rights registration records (staged / submitted / failed).
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit') ?? 50) || 50, 1), 200);
  const records = await listRegistrations(limit);
  return NextResponse.json({ records, total: records.length });
}
