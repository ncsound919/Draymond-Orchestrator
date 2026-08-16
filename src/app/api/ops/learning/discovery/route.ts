import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { readLearningStore, saveDiscoveries } from '@/lib/draymond/learning-store';

export const dynamic = 'force-dynamic';

/** POST /api/ops/learning/discovery — publish a research-grade discovery */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as { discovery?: any };
  if (!body.discovery || typeof body.discovery.goalId !== 'string') {
    return NextResponse.json({ error: 'discovery.goalId required' }, { status: 400 });
  }
  const store = await readLearningStore();
  const deduped = store.discoveries.filter((d) => d.goalId !== body.discovery.goalId);
  deduped.push(body.discovery);
  await saveDiscoveries(deduped);
  return NextResponse.json({ ok: true });
}
