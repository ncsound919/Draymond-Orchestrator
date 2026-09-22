import { NextRequest, NextResponse } from 'next/server';
import { decideFor } from '@/lib/draymond/jevClient';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

const KINDS = ['daily', 'cron', 'repair', 'report', 'learning', 'service', 'brain'] as const;

/**
 * POST /api/jev/decide — one Jev (System One) ops decision for Draymond.
 * Body: { kind: 'daily'|'cron'|'repair'|'report'|'learning'|'service'|'brain', ...inputs }
 *   daily    { tasks: [{id,label}] }
 *   cron     { job: {name, job_type} }
 *   repair   { failure: {signal, kind?, detail?} }
 *   report   { report: {topic, length?} }
 *   learning { lessons: [{id, lesson, evidenceCount?}] }
 *   service  { service: {slug,name,port,health}, action: 'start'|'stop'|'restart' }
 *   brain    { decision: {focusGoal, priorities, repairQueueLength} }
 * Returns { ok, kind, jev, raw: {source, model, latencyMs} }. The deterministic
 * orchestrator stays authoritative; Jev adds a calibrated choice/noul/score
 * advisory. Both tiers down => jev.source 'offline' (never fabricated).
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const parsed = await parseJsonBody<Record<string, unknown>>(request);
  if (parsed.error) return parsed.error;
  const data = parsed.data ?? {};

  const kind = data.kind as (typeof KINDS)[number];
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ ok: false, error: `kind must be one of: ${KINDS.join(', ')}` }, { status: 400 });
  }

  try {
    const { jev, result } = await decideFor(kind, data);
    return NextResponse.json({
      ok: true,
      kind,
      jev,
      raw: { source: result.source, model: result.model, latencyMs: result.latencyMs },
    });
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}