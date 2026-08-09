import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { kairosFeed } from '@/lib/draymond/kairos';
import type { KairosSeverity } from '@/lib/draymond/kairos';

export const dynamic = 'force-dynamic';

/** GET /api/cognition/kairos?limit=&kind=&severity=&acked= — Kairos feed */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const sp = request.nextUrl.searchParams;
  const severityRaw = sp.get('severity');
  const feed = await kairosFeed({
    limit: Number(sp.get('limit') ?? 50),
    kind: sp.get('kind') ?? undefined,
    severity: severityRaw === 'info' || severityRaw === 'warn' || severityRaw === 'critical' ? severityRaw : (undefined as KairosSeverity | undefined),
    acked: sp.has('acked') ? sp.get('acked') === 'true' : undefined,
  });
  return NextResponse.json({ moments: feed });
}
