// ============================================================================
// GET & POST /api/entities — Unified Entity Registry API
// ============================================================================
// GET  — List/search entities with flexible filters
// POST — Register a new entity in the registry
//
// Protected by CRON_SECRET — the caller must send:
//   Authorization: Bearer <CRON_SECRET>
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { searchEntities, registerEntity } from '@/lib/draymond/registry';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import type { EntitySearchFilters, DraymondEntityInsert } from '@/lib/draymond/types';

export const dynamic = 'force-dynamic';

// Valid values for the `kind` filter
const VALID_KINDS = ['agent', 'tool', 'skill', 'extension', 'mcp_server', 'service', 'workflow', 'data_source', 'integration'] as const;

// ── GET /api/entities ───────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = request.nextUrl;

    const filters: EntitySearchFilters = {};

    const kind = url.searchParams.get('kind');
    if (kind) {
      if (!VALID_KINDS.includes(kind as typeof VALID_KINDS[number])) {
        return NextResponse.json(
          { ok: false, error: `Invalid kind: "${kind}". Must be one of: ${VALID_KINDS.join(', ')}` },
          { status: 400 },
        );
      }
      filters.kind = kind as EntitySearchFilters['kind'];
    }

    const category = url.searchParams.get('category');
    if (category) filters.category = category;

    const sector = url.searchParams.get('sector');
    if (sector) filters.sector = sector;

    const capability = url.searchParams.get('capability');
    if (capability) filters.capability = capability;

    const tag = url.searchParams.get('tag');
    if (tag) filters.tag = tag;

    const search = url.searchParams.get('search');
    if (search) filters.search = search;

    const isActive = url.searchParams.get('is_active');
    if (isActive !== null) filters.is_active = isActive === 'true';

    const isIntegrated = url.searchParams.get('is_integrated');
    if (isIntegrated !== null) filters.is_integrated = isIntegrated === 'true';

    const limit = url.searchParams.get('limit');
    if (limit) filters.limit = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));

    const offset = url.searchParams.get('offset');
    if (offset) filters.offset = Math.max(0, parseInt(offset, 10) || 0);

    const entities = await searchEntities(filters);

    return NextResponse.json({
      ok: true,
      entities,
      count: entities.length,
    });
  } catch (err) {
    console.error('[Entities API] GET failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: sanitizeError(err) },
      { status: 500 },
    );
  }
}

// ── POST /api/entities ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody(request);
  if (parseError) return parseError;

  try {
    // Basic required field check
    const b = body as Record<string, unknown>;
    if (!b.slug || typeof b.slug !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: slug' },
        { status: 400 },
      );
    }
    if (!b.name || typeof b.name !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: name' },
        { status: 400 },
      );
    }
    if (!b.kind || typeof b.kind !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: kind' },
        { status: 400 },
      );
    }

    const entity = await registerEntity(body as DraymondEntityInsert);

    return NextResponse.json({ ok: true, entity }, { status: 201 });
  } catch (err) {
    console.error('[Entities API] POST failed:', err instanceof Error ? err.message : err);

    const message = sanitizeError(err);
    const status = message.includes('already exists') || message.includes('Invalid') ? 400 : 500;

    return NextResponse.json(
      { ok: false, error: message },
      { status },
    );
  }
}
