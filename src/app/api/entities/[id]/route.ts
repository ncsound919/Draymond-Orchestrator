// ============================================================================
// GET, PATCH, DELETE /api/entities/[id] — Single Entity Operations
// ============================================================================
// GET    — Retrieve a single entity by ID or slug
// PATCH  — Update an existing entity (allowlisted fields only)
// DELETE — Deactivate (soft-delete) an entity
//
// Protected by CRON_SECRET — the caller must send:
//   Authorization: Bearer <CRON_SECRET>
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getEntity, updateEntity, deactivateEntity } from '@/lib/draymond/registry';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

// Fields allowed in PATCH updates
const ALLOWED_PATCH_FIELDS = new Set([
  'name',
  'description',
  'category',
  'sector',
  'capabilities',
  'tags',
  'health_status',
  'is_active',
  'is_integrated',
  'invocation_method',
  'invocation_config',
  'input_schema',
  'output_schema',
  'timeout_seconds',
  'pricing',
  'depends_on',
  'metadata',
]);

// ── GET /api/entities/[id] ──────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const entity = await getEntity(id);

    if (!entity) {
      return NextResponse.json(
        { ok: false, error: `Entity "${id}" not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, entity });
  } catch (err) {
    console.error('[Entity API] GET failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: sanitizeError(err) },
      { status: 500 },
    );
  }
}

// ── PATCH /api/entities/[id] ────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { id } = await params;

  const { data: body, error: parseError } = await parseJsonBody<Record<string, unknown>>(request);
  if (parseError) return parseError;

  try {
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Request body must be a non-empty JSON object' },
        { status: 400 },
      );
    }

    // Filter to only allowed fields
    const updates: Record<string, unknown> = {};
    const rejected: string[] = [];
    for (const key of Object.keys(body)) {
      if (ALLOWED_PATCH_FIELDS.has(key)) {
        updates[key] = body[key];
      } else {
        rejected.push(key);
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { ok: false, error: `No valid fields to update. Rejected: ${rejected.join(', ')}` },
        { status: 400 },
      );
    }

    const entity = await updateEntity(id, updates);

    return NextResponse.json({ ok: true, entity });
  } catch (err) {
    console.error('[Entity API] PATCH failed:', err instanceof Error ? err.message : err);

    const message = sanitizeError(err);
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: message },
      { status },
    );
  }
}

// ── DELETE /api/entities/[id] ───────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    await deactivateEntity(id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Entity API] DELETE failed:', err instanceof Error ? err.message : err);

    const message = sanitizeError(err);
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json(
      { ok: false, error: message },
      { status },
    );
  }
}
