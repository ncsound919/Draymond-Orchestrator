import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { runPythonLayers } from '@/lib/sports/pythonExecutors';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/science/translate
 *   { terms: string[], layer?: 'all'|'terminology'|'strategy'|'procedure', from_sports?: boolean }
 * Layered sports <-> biotech translation.
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    terms?: string[];
    layer?: string;
    from_sports?: boolean;
  }>(request);
  if (parseError) return parseError;

  const terms = body?.terms ?? [];
  if (!Array.isArray(terms) || terms.length === 0) {
    return NextResponse.json({ ok: false, error: 'terms required' }, { status: 400 });
  }
  try {
    const res = await runPythonLayers(
      terms.map((t) => String(t)),
      body?.layer ?? 'all',
      body?.from_sports ?? true,
    );
    return NextResponse.json({ ok: res.success, ...res.data, error: res.error });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 400 });
  }
}
