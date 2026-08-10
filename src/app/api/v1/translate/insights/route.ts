import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { runPythonInsights, runPythonTranslate } from '@/lib/sports/pythonExecutors';

export const dynamic = 'force-dynamic';

/**
 * Shared bidirectional insight endpoint.
 *   POST /api/v1/translate/insights
 *     { mode: 'insights', profile: {...}, from_domain?: 'sports'|'biotech' }
 *     { mode: 'translate', term: string, value?: number, from_sports?: boolean }
 * Returns the executor's wrapped { data: [...] } contract.
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    mode?: 'insights' | 'translate';
    profile?: Record<string, unknown>;
    term?: string;
    value?: number;
    from_sports?: boolean;
    from_domain?: 'sports' | 'biotech';
  }>(request);
  if (parseError) return parseError;

  try {
    const mode = body?.mode ?? 'insights';
    if (mode === 'translate') {
      const term = body?.term ?? '';
      const res = await runPythonTranslate(term, body?.value, body?.from_sports ?? true);
      return NextResponse.json({ ok: res.success, ...res.data, error: res.error });
    }
    const profile = body?.profile ?? {};
    if (typeof profile !== 'object' || profile === null || Object.keys(profile).length === 0) {
      return NextResponse.json({ ok: false, error: 'profile required' }, { status: 400 });
    }
    const res = await runPythonInsights(profile, body?.from_domain === 'biotech');
    return NextResponse.json({ ok: res.success, ...res.data, error: res.error });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 400 });
  }
}
