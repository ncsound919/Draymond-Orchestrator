/**
 * POST /api/ventures — submit an ABCD venture for execution.
 * Body: { name, description?, revenue_lane, revenue_note?, steps, agent_id? }
 * Auth: CRON_SECRET bearer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { submitVenture, listVentures, type VentureStepInput } from '@/lib/draymond/ventures';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  return NextResponse.json({ ok: true, ventures: await listVentures() });
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<Record<string, unknown>>(request);
  if (parseError) return parseError;

  if (typeof body.name !== 'string' || !Array.isArray(body.steps) || body.steps.length === 0) {
    return NextResponse.json({ ok: false, error: 'name and steps[] are required' }, { status: 400 });
  }
  const malformed = (body.steps as unknown[]).some(
    (s) =>
      typeof (s as Record<string, unknown>)?.entity_slug !== 'string' ||
      typeof (s as Record<string, unknown>)?.action !== 'string',
  );
  if (malformed) {
    return NextResponse.json({ ok: false, error: 'each step requires string entity_slug and action' }, { status: 400 });
  }
  const lane = ['service', 'subscription', 'checkout', 'tooling'].includes(String(body.revenue_lane))
    ? (String(body.revenue_lane) as 'service' | 'subscription' | 'checkout' | 'tooling')
    : 'service';

  try {
    const record = await submitVenture({
      name: body.name,
      description: typeof body.description === 'string' ? body.description : undefined,
      revenue_lane: lane,
      revenue_note: typeof body.revenue_note === 'string' ? body.revenue_note : undefined,
      steps: body.steps as VentureStepInput[],
      agent_id: typeof body.agent_id === 'string' ? body.agent_id : undefined,
    });
    return NextResponse.json({ ok: true, venture: record }, { status: record.status === 'pending_review' ? 202 : 200 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
