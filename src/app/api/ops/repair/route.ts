import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { attemptRepair, repairLog } from '@/lib/draymond/self-repair';

export const dynamic = 'force-dynamic';

/** GET /api/ops/repair — recent repair attempts */
export async function GET() {
  const authError = authorizeRequest(new NextRequest('http://localhost'));
  if (authError) return authError;
  return NextResponse.json({ log: await repairLog() });
}

/** POST /api/ops/repair — attempt a repair { signal, detail } */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { signal, detail } = body;
  if (typeof signal !== 'string') {
    return NextResponse.json({ error: 'signal is required (e.g. monitor:down, qa:fail, job:error)' }, { status: 400 });
  }
  const attempt = await attemptRepair(signal, typeof detail === 'string' ? detail : signal);
  return NextResponse.json(attempt, { status: attempt.status === 'applied' ? 200 : 202 });
}
