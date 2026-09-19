import { NextResponse } from 'next/server';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import { buildVisualizerSnapshot } from '@/lib/visualizer/snapshot';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request) {
  // Browser-session auth (the visualizer page fetches this directly, so the
  // Bearer CRON_SECRET path doesn't apply — cookie session does).
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;
  try {
    const snapshot = await buildVisualizerSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}