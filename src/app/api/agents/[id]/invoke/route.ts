// ============================================================================
// POST /api/agents/:id/invoke — Invoke a Registry Entity
// ============================================================================
// Looks up an entity by ID (or slug) from the unified registry, then
// dispatches an invocation via the invoker bridge. Records the invocation
// timestamp and returns the structured result.
//
// Protected by CRON_SECRET — the caller must send:
//   Authorization: Bearer <CRON_SECRET>
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getEntity, recordInvocation } from '@/lib/draymond/registry';
import { invokeEntity } from '@/lib/draymond/invoker';
import type { EntityForInvocation } from '@/lib/draymond/invoker';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  // ── Parse params & body ─────────────────────────────────────────────
  const { id } = await params;

  const { data: body, error: parseError } = await parseJsonBody<{
    action: string;
    input?: Record<string, unknown>;
    timeout_ms?: number;
  }>(request);
  if (parseError) return parseError;

  if (!body.action || typeof body.action !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Missing required field: action' },
      { status: 400 },
    );
  }

  // ── Look up entity ──────────────────────────────────────────────────
  try {
    const entity = await getEntity(id);

    if (!entity) {
      return NextResponse.json(
        { ok: false, error: `Entity "${id}" not found` },
        { status: 404 },
      );
    }

    // ── Build minimal entity shape for invoker ────────────────────────
    const entityMinimal: EntityForInvocation = {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      kind: entity.kind,
      invocation_method: entity.invocation_method,
      invocation_config: (entity.invocation_config as Record<string, unknown>) ?? {},
      timeout_seconds: entity.timeout_seconds,
    };

    // ── Invoke ────────────────────────────────────────────────────────
    const result = await invokeEntity(
      entityMinimal,
      body.action,
      body.input ?? {},
      { timeout_ms: body.timeout_ms },
    );

    // ── Record invocation timestamp ───────────────────────────────────
    try {
      await recordInvocation(entity.id);
    } catch (recordErr) {
      // Non-fatal — log but don't fail the request
      console.error(
        '[API /agents/:id/invoke] Failed to record invocation:',
        recordErr instanceof Error ? recordErr.message : recordErr,
      );
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('[API /agents/:id/invoke]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
