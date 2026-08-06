import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { computeFleetDuty, FLEET_DUTY, nextShiftStart } from '@/lib/draymond/fleet-duty';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scheduling/status
 * Fleet duty roster right now: always-on (crons), shift agents (active windows),
 * on-call agents (paged). Returns on-duty roster + next shift starts.
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const now = new Date();
  const roster = computeFleetDuty(now);
  const onDuty = roster.filter((r) => r.active);

  const shifts = FLEET_DUTY.filter((a) => a.duty === 'shift' && a.shift).map((a) => {
    const next = a.shift ? nextShiftStart(a.shift, now) : null;
    return {
      agentId: a.agentId,
      window: `${a.shift?.start}-${a.shift?.end}`,
      label: a.shift?.label,
      nextStart: next ? `${next.start} (+${next.daysUntil}d)` : null,
    };
  });

  return NextResponse.json({
    checkedAt: now.toISOString(),
    counts: {
      alwaysOn: roster.filter((r) => r.duty === 'always-on').length,
      shift: roster.filter((r) => r.duty === 'shift').length,
      onCall: roster.filter((r) => r.duty === 'on-call').length,
      onDuty: onDuty.length,
    },
    onDuty,
    roster,
    shifts,
  });
}
