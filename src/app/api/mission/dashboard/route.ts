import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { missionDashboard } from '@/lib/draymond/mission-pipeline';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = authorizeRequest(new NextRequest('http://localhost'));
  if (authError) return authError;
  return NextResponse.json(await missionDashboard());
}
