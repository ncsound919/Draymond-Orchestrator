// ============================================================================
// POST /api/v1/worker/heartbeat — Worker heartbeat / liveness
// ============================================================================
// Registers (or refreshes) a worker in the in-memory liveness map and pushes a
// client.connected event (only on first sighting / re-connect) to connected
// SSE clients (best-effort). Stale workers are evicted on every beat.
//
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { emitClientConnected } from '@/lib/draymond/event-bridge';

export const dynamic = 'force-dynamic';

type WorkerStatus = {
  last_seen: string;
  platform?: string;
  version?: string;
};

const workers = new Map<string, WorkerStatus>();

// Clean up stale workers every 5 minutes
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

function cleanStaleWorkers(): void {
  const now = Date.now();
  for (const [id, worker] of workers) {
    if (now - new Date(worker.last_seen).getTime() > STALE_THRESHOLD_MS) {
      workers.delete(id);
    }
  }
}

// ── POST /api/v1/worker/heartbeat ───────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    client_id?: string;
    platform?: string;
    version?: string;
  }>(request);
  if (parseError) return parseError;

  try {
    if (!body.client_id || typeof body.client_id !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'Missing required field: client_id' },
        { status: 400 },
      );
    }

    cleanStaleWorkers();

    const wasNew = !workers.has(body.client_id);
    workers.set(body.client_id, {
      last_seen: new Date().toISOString(),
      platform: body.platform,
      version: body.version,
    });

    if (wasNew) {
      try {
        emitClientConnected(body.client_id, workers.size);
      } catch {
        // Non-fatal: SSE push is best-effort
      }
    }

    return NextResponse.json({ ok: true, worker_count: workers.size });
  } catch (err) {
    console.error('[API /api/v1/worker/heartbeat]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

/** Test hook — clears the in-memory worker map. */
export function _reset(): void {
  workers.clear();
}
