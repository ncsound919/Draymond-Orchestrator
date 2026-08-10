import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { runPythonFormula } from '@/lib/sports/pythonExecutors';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/science/formula
 *   { box: {FG, FGA, 3P, 3PA, FT, FTA, REB, AST, STL, BLK, TOV, PF, PTS, MP}, stat?: 'PER'|'TS_PCT'|... }
 * Computes NBA advanced stats + biotech analogs (math-x / SymPy verified).
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    box?: Record<string, unknown>;
    stat?: string;
  }>(request);
  if (parseError) return parseError;

  const box = body?.box ?? {};
  if (typeof box !== 'object' || box === null || Object.keys(box).length === 0) {
    return NextResponse.json({ ok: false, error: 'box score required' }, { status: 400 });
  }
  try {
    const res = await runPythonFormula(box, body?.stat);
    return NextResponse.json({ ok: res.success, ...res.data, error: res.error });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 400 });
  }
}
