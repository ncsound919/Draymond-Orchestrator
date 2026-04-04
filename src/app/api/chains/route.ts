// ============================================================================
// /api/chains — Chain CRUD (list & create)
// ============================================================================
// GET  — List chains with optional filters (is_template, status, created_by, limit)
// POST — Create a new chain from a DraymondChainInsert body
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { listChains, createChain } from '@/lib/draymond/chains';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import type { DraymondChainInsert, ChainStatus } from '@/lib/draymond/types';

export const dynamic = 'force-dynamic';

// Valid values for query param validation
const VALID_STATUSES: ChainStatus[] = [
  'draft', 'active', 'running', 'paused', 'completed', 'failed', 'cancelled', 'archived',
];

// ── GET /api/chains ─────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);

    const isTemplateRaw = url.searchParams.get('is_template');
    const created_by = url.searchParams.get('created_by') ?? undefined;
    const limitRaw = url.searchParams.get('limit');

    // Validate status param
    const statusRaw = url.searchParams.get('status');
    let status: ChainStatus | undefined;
    if (statusRaw) {
      if (!VALID_STATUSES.includes(statusRaw as ChainStatus)) {
        return NextResponse.json(
          { ok: false, error: `Invalid status: "${statusRaw}". Must be one of: ${VALID_STATUSES.join(', ')}` },
          { status: 400 },
        );
      }
      status = statusRaw as ChainStatus;
    }

    // Cap limit to prevent abuse
    let limit: number | undefined;
    if (limitRaw) {
      limit = Math.max(1, Math.min(200, parseInt(limitRaw, 10) || 50));
    }

    const filters: Parameters<typeof listChains>[0] = {
      is_template: isTemplateRaw !== null ? isTemplateRaw === 'true' : undefined,
      status,
      created_by,
      limit,
    };

    const chains = await listChains(filters);
    return NextResponse.json({ ok: true, chains });
  } catch (err) {
    console.error('[API /api/chains GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// ── POST /api/chains ────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<DraymondChainInsert>(request);
  if (parseError) return parseError;

  try {
    // Basic required field validation
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: name' },
        { status: 400 },
      );
    }
    if (!body.slug || typeof body.slug !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: slug' },
        { status: 400 },
      );
    }

    const chain = await createChain(body);
    return NextResponse.json({ ok: true, chain }, { status: 201 });
  } catch (err) {
    console.error('[API /api/chains POST]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
