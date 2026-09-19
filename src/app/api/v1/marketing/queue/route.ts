// ============================================================================
// GET /api/v1/marketing/queue — SMD publish queue snapshot for Open Chat review
// ============================================================================
// Returns the Social Media Dashboard publish queue (pending posts) so Open
// Chat can present them for human approval. Read-only.
//
// Auth: CRON_SECRET Bearer.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/** The SMD queue file path (mirrors SMD src/ai/api.py SCHEDULE_FILE). */
const SMD_QUEUE_FILE =
  process.env.SMD_QUEUE_FILE ??
  'C:/Users/User/Downloads/Uplift/Draymond-Orchestrator/agents/Social-Media-Dashboard--main/media/schedule/queue.json';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const fs = await import('node:fs');
    if (!/*turbopackIgnore: true*/ fs.existsSync(SMD_QUEUE_FILE)) {
      return NextResponse.json({ ok: true, total: 0, queue: [] });
    }
    const raw = /*turbopackIgnore: true*/ fs.readFileSync(SMD_QUEUE_FILE, 'utf8');
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
