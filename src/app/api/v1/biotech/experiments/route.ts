import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';
import { getExperimentsMap } from '@/lib/biotech/api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const experiments = await getExperimentsMap();
    return NextResponse.json({ ok: true, ...experiments });
  } catch (err) {
    console.error('[API /api/v1/biotech/experiments GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
