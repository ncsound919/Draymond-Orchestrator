import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { buildVisualizerSnapshot } from '@/lib/visualizer/snapshot';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const snapshot = await buildVisualizerSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}