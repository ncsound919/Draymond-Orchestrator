// ============================================================================
// /api/v1/worker/skills — Worker skill pack catalog (GET & POST)
// ============================================================================
// GET  — List skill packs (optionally filtered by review status)
// POST — Propose a new skill pack from a worker (enters the review queue)
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { listSkillPacks, proposeSkillPack } from '@/lib/draymond/skill-packs';

export const dynamic = 'force-dynamic';

const VALID_REVIEW_STATUSES = ['draft', 'approved', 'rejected'] as const;

// -- GET /api/v1/worker/skills -----------------------------------------------
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);

    let status: string | undefined = url.searchParams.get('review_status') ?? undefined;
    if (status === undefined) status = 'approved';

    if (status && !VALID_REVIEW_STATUSES.includes(status as typeof VALID_REVIEW_STATUSES[number])) {
      return NextResponse.json(
        { ok: false, error: `Invalid review_status. Must be one of: ${VALID_REVIEW_STATUSES.join(', ')}` },
        { status: 400 },
      );
    }

    const skills = await listSkillPacks(status as typeof VALID_REVIEW_STATUSES[number] | undefined);
    return NextResponse.json({ ok: true, skills });
  } catch (err) {
    console.error('[API /api/v1/worker/skills GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

// -- POST /api/v1/worker/skills ----------------------------------------------
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    pack?: Record<string, unknown>;
    worker_id?: string;
  }>(request);
  if (parseError) return parseError;

  try {
    if (!body.pack || typeof body.pack !== 'object' || !body.pack.name) {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: pack.name' },
        { status: 400 },
      );
    }

    await proposeSkillPack(body.worker_id?.trim() || 'default', body.pack);

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error('[API /api/v1/worker/skills POST]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
