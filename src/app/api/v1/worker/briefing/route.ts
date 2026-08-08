// ============================================================================
// GET /api/v1/worker/briefing — Worker briefing (recent task history)
// ============================================================================
// Returns the last 10 tasks for a worker so it can resume context on reconnect.
// JSON columns (payload/result/artifact_refs) are auto-parsed by COLUMN_MAPS.
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';
import { createDraymondAdminClient } from '@/lib/draymond/client';

export const dynamic = 'force-dynamic';

// ── GET /api/v1/worker/briefing ─────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);

    const workerId = url.searchParams.get('worker_id') ?? 'default';

    const supabase = createDraymondAdminClient();
    const { data, error } = await supabase
      .from('draymond_worker_tasks')
      .select('*')
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    return NextResponse.json({ ok: true, worker_id: workerId, tasks: data ?? [] });
  } catch (err) {
    console.error('[API /api/v1/worker/briefing]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
