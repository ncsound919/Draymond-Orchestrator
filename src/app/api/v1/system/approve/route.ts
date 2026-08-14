import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';
import { mintSystemApproval } from '@/lib/draymond/system-agent';

export const dynamic = 'force-dynamic';

const VALID_ACTIONS = ['launch', 'kill', 'power', 'file', 'service', 'priority'];

/**
 * POST /api/v1/system/approve — mint a short-lived approval token for a
 * dangerous system control action. Callers must already be authorized with the
 * CRON_SECRET (i.e. trusted Draymond API surface). The token is HMAC-signed,
 * bound to action+target, and expires in 5 minutes.
 *
 * Body: { action: 'launch'|'kill'|'power'|'file'|'service'|'priority', target: string }
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const parsed = await parseJsonBody<{ action?: string; target?: string }>(request);
  if (parsed.error) return parsed.error;
  const { action, target } = parsed.data;

  if (!action || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action must be one of ${VALID_ACTIONS.join(', ')}` }, { status: 400 });
  }
  if (!target || typeof target !== 'string' || target.length > 512) {
    return NextResponse.json({ error: 'target (string) required' }, { status: 400 });
  }

  const token = mintSystemApproval(action as any, target);
  if (!token) {
    return NextResponse.json({ error: 'SYSTEM_AGENT_APPROVAL_SECRET not configured' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    token,
    action,
    target,
    ttlSeconds: 300,
    usage: `Pass the token to the system-agent as X-Approval-Token (via POST /api/v1/system?kind=${action})`,
  });
}
