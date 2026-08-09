// ============================================================================
// GET /api/ops/catalog — unified operational inventory of all moving parts.
// ============================================================================
// Returns the full catalog grouped by kind and category (agents, skills,
// tools, services, extensions, MCP servers, workflows, chains, jobs), plus
// totals and a capability index. Read-only; derives from the entity DB,
// file registry, chain table, and job definitions.
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';
import { buildOpsCatalog } from '@/lib/draymond/ops-catalog';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const catalog = await buildOpsCatalog();
    return NextResponse.json({ ok: true, catalog });
  } catch (err) {
    console.error('[API /api/ops/catalog GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
