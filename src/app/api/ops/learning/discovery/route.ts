import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { upsertDiscovery } from '@/lib/draymond/learning-store';

export const dynamic = 'force-dynamic';

/** POST /api/ops/learning/discovery — publish a research-grade discovery */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as { discovery?: any };
  const discovery = body.discovery;
  if (
    !discovery ||
    typeof discovery.goalId !== 'string' ||
    !Number.isFinite(discovery.score)
  ) {
    return NextResponse.json(
      { error: 'discovery.goalId (string) and a finite numeric discovery.score are required' },
      { status: 400 },
    );
  }
  await upsertDiscovery(discovery);
  return NextResponse.json({ ok: true });
}
