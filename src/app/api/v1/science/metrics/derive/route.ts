import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { runPythonDerive } from '@/lib/sports/pythonExecutors';

export const dynamic = 'force-dynamic';

/**
 * Metrics Lab: derive NEW composite statistics over bbtech session profiles.
 *   POST /api/v1/science/metrics/derive
 *     { session_id: string, domain?: 'sports'|'biotech', profile?: {...}|path }
 * Successful runs auto-persist into the trends store with source
 * 'bbtech_metrics_lab' and metric_kind 'derived' (see runPythonDerive).
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    session_id?: string;
    domain?: string;
    profile?: string | Record<string, unknown>;
  }>(request);
  if (parseError) return parseError;

  const sessionId = body?.session_id?.trim();
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'session_id required' }, { status: 400 });
  }
  const profile = body?.profile;
  if (
    profile !== undefined &&
    typeof profile !== 'string' &&
    (typeof profile !== 'object' || profile === null || Array.isArray(profile))
  ) {
    return NextResponse.json(
      { ok: false, error: 'profile must be an object or a path string' },
      { status: 400 },
    );
  }

  try {
    const res = await runPythonDerive(sessionId, profile, body?.domain);
    return NextResponse.json({
      ok: res.success,
      ...res.data,
      error: res.error,
      ...(res.persisted ? { persisted: res.persisted } : {}),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 400 });
  }
}
