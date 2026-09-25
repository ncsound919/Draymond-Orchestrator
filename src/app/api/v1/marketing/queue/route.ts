// ============================================================================
// GET /api/v1/marketing/queue — marketing publish queue snapshot for Open Chat
// ============================================================================
// Returns the marketing publish queue (pending posts) so Open Chat can present
// them for human approval. Read-only. The Social Media Dashboard was
// decommissioned 2026-09-24; Postiz is the publisher.
//
// Auth: CRON_SECRET Bearer.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { MARKETING_QUEUE_FILE } from '@/lib/draymond/marketing-team';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const fs = await import('node:fs');
    if (!/*turbopackIgnore: true*/ fs.existsSync(MARKETING_QUEUE_FILE)) {
      return NextResponse.json({ ok: true, total: 0, queue: [] });
    }
    const raw = /*turbopackIgnore: true*/ fs.readFileSync(MARKETING_QUEUE_FILE, 'utf8');
    const queue = JSON.parse(raw);
    const items = Array.isArray(queue) ? queue : [];
    return NextResponse.json({ ok: true, total: items.length, queue: items });
  } catch (err) {
    console.error('[API /api/v1/marketing/queue]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
