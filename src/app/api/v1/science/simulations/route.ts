import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { runModelById, runModelSpec } from '@/lib/science/sim';

export const dynamic = 'force-dynamic';

/**
 * Direct simulation run.
 *   POST /api/v1/science/simulations
 *     { model_id, ticks?, params? }        → run a seeded model by id
 *     { spec: { ...model }, ticks? }       → run an inline model spec
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    model_id?: string;
    spec?: Record<string, unknown>;
    ticks?: number;
    params?: Record<string, number>;
  }>(request);
  if (parseError) return parseError;

  try {
    if (body?.spec) {
      const out = await runModelSpec(body.spec, body.ticks);
      return NextResponse.json({ ok: out.error ? false : true, ...out });
    }
    if (!body?.model_id) {
      return NextResponse.json({ ok: false, error: 'model_id or spec required' }, { status: 400 });
    }
    const out = await runModelById(body.model_id, body.ticks, body.params);
    return NextResponse.json({ ok: out.error ? false : true, ...out });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
