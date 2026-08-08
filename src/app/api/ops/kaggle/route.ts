import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { kaggleStatus, kaggleSearchDatasets, kaggleCompetitions, isKaggleConfigured } from '@/lib/draymond/data-apis';

export const dynamic = 'force-dynamic';

/** GET /api/ops/kaggle — credential status + competition memberships */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const [status, competitions] = await Promise.all([
      kaggleStatus(),
      kaggleCompetitions().catch(() => ({ ok: false as const, detail: 'competitions probe failed' })),
    ]);
    return NextResponse.json({ configured: isKaggleConfigured(), status, competitions });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

/** POST /api/ops/kaggle — { query } search datasets */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const body = (await request.json().catch(() => ({}))) as { query?: string };
    const query = body.query?.trim();
    if (!query) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }
    const result = await kaggleSearchDatasets(query);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
