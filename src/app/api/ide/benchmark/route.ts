import { NextRequest, NextResponse } from 'next/server';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import { runIdeBenchmark, getLatestBenchmarkRun, getIdeBenchmarkBaseline } from '@/lib/ide';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ide/benchmark — run the IDE benchmark and return the run.
 * Each tool is exercised with a standard task; results persist to the baseline
 * and feed the self-learning store (repair team / future sessions).
 */
export async function POST(request: NextRequest) {
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    const workspaceRoot = typeof body?.workspaceRoot === 'string' ? body.workspaceRoot : undefined;
    const skipLandingPage = body?.skipLandingPage === true;
    const run = await runIdeBenchmark({ workspaceRoot, skipLandingPage });
    return NextResponse.json({ run });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Benchmark failed' },
      { status: 500 },
    );
  }
}

/** GET /api/ide/benchmark — latest run + baseline history. */
export async function GET() {
  const auth = await requireDraymondAuth();
  if (auth.error) return auth.error;

  const [latest, baseline] = await Promise.all([getLatestBenchmarkRun(), getIdeBenchmarkBaseline()]);
  return NextResponse.json({ latest, baseline });
}
