// ============================================================================
// /api/command-center/deploy — Command Center deploy (DeployProvider)
// ============================================================================
// POST /api/command-center/deploy — deploy a target
//   { kind: 'local', process?: string, url?: string, expectedStatus?: number }
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { getDeployProvider } from '@/lib/command-center/deploy';
import type { DeployTarget } from '@/lib/command-center/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const { data: body, error: parseError } = await parseJsonBody<Partial<DeployTarget>>(request);
  if (parseError) return parseError;
  try {
    const kind = body.kind ?? 'local';
    const target: DeployTarget = {
      id: typeof body.id === 'string' ? body.id : 'local',
      name: typeof body.name === 'string' ? body.name : 'Local deploy',
      kind,
      process: typeof body.process === 'string' ? body.process : undefined,
      url: typeof body.url === 'string' ? body.url : undefined,
      expectedStatus:
        typeof body.expectedStatus === 'number' ? body.expectedStatus : undefined,
    };
    if (!target.process && !target.url) {
      return NextResponse.json(
        { ok: false, error: 'deploy requires a process or url' },
        { status: 400 },
      );
    }
    const provider = getDeployProvider(kind);
    const result = await provider.deploy(target);
    return NextResponse.json({ ok: result.ok, result }, { status: result.ok ? 200 : 500 });
  } catch (err) {
    console.error('[api/command-center/deploy] POST', err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
