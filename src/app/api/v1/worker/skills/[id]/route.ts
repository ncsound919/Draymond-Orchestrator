// ============================================================================
// GET /api/v1/worker/skills/:id — Fetch a single skill pack by name:version
// ============================================================================
// The id is `name:version` (version defaults to '1.0.0'). Returns 404 if the
// pack does not exist.
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';
import { getSkillPack } from '@/lib/draymond/skill-packs';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    const [name, versionRaw] = id.split(':');
    const version = versionRaw || '1.0.0';

    const skill = await getSkillPack(name, version);

    if (!skill) {
      return NextResponse.json(
        { ok: false, error: `Skill pack "${id}" not found` },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, skill });
  } catch (err) {
    console.error('[API /api/v1/worker/skills/:id]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
