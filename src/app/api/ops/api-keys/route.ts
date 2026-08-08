import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { auditApiKeys, missingCriticalKeys } from '@/lib/draymond/api-keys';

export const dynamic = 'force-dynamic';

/** GET /api/ops/api-keys — free-API key registry status (never the keys themselves) */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const audit = auditApiKeys();
    return NextResponse.json(audit);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

/** POST /api/ops/api-keys — run the audit + record an outcome for self-learning */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const audit = auditApiKeys();
    try {
      const { recordOutcome } = await import('@/lib/draymond/self-learning');
      await recordOutcome({
        agentId: 'api-key-audit',
        kind: 'incident',
        summary: `api key audit: ${audit.configured} configured, ${audit.missing} missing, ${audit.noKey} keyless`,
        success: audit.missing === 0,
        detail: `missing: ${audit.missingNames.join(', ') || 'none'}`,
      });
    } catch { /* learning store best-effort */ }
    return NextResponse.json({ ...audit, criticalMissing: missingCriticalKeys() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
