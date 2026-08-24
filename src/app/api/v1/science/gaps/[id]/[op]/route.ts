import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, isValidId, sanitizeError } from '@/lib/draymond/api-auth';
import { transitionGap } from '@/lib/science/researchEscalation';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; op: string }> };

/**
 * Lifecycle transition for a research gap.
 *   POST /api/v1/science/gaps/:id/:op   (op: research|resolve)
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { id, op } = await ctx.params;
  if (!isValidId(id)) {
    return NextResponse.json({ ok: false, error: 'Invalid id format' }, { status: 400 });
  }
  if (op !== 'research' && op !== 'resolve') {
    return NextResponse.json(
      { ok: false, error: `unknown op: ${op} (expected research|resolve)` },
      { status: 400 },
    );
  }

  try {
    const result = await transitionGap(id, op);
    if (!result.ok) {
      const status = String(result.error ?? '').startsWith('unknown gap') ? 404 : 400;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json({ ok: true, gap: result.gap });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 400 });
  }
}
