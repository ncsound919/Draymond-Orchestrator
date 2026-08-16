import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { readLearningStore } from '@/lib/draymond/learning-store';

export const dynamic = 'force-dynamic';

/** GET /api/ops/learning/store — full shared learning store snapshot */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  return NextResponse.json(await readLearningStore());
}
