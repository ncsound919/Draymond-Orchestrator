/**
 * GET  /api/monitors        — List all site monitors (optional ?enabled=true filter)
 * POST /api/monitors        — Create a new site monitor
 *
 * Protected by CRON_SECRET — the caller must send:
 *   Authorization: Bearer <CRON_SECRET>
 */
import { NextRequest, NextResponse } from 'next/server';
import { listMonitors, createMonitor } from '@/lib/draymond/monitors';
import type { MonitorListFilters } from '@/lib/draymond/monitors';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Auth helper (mirrors /api/cron pattern)
// ---------------------------------------------------------------------------

function checkCronAuth(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[api/monitors] CRON_SECRET env var is not set');
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = request.nextUrl;
    const filters: MonitorListFilters = {};

    const enabledParam = searchParams.get('enabled');
    if (enabledParam !== null) {
      filters.is_enabled = enabledParam === 'true';
    }

    const statusParam = searchParams.get('status');
    if (statusParam) {
      filters.current_status = statusParam as MonitorListFilters['current_status'];
    }

    const limitParam = searchParams.get('limit');
    if (limitParam) {
      filters.limit = parseInt(limitParam, 10);
    }

    const monitors = await listMonitors(filters);

    return NextResponse.json({
      monitors,
      total: monitors.length,
    });
  } catch (err) {
    console.error('[api/monitors] GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list monitors' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { name, url } = body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'name is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'url is required and must be a string' },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { error: 'url must be a valid URL (e.g. https://example.com)' },
        { status: 400 }
      );
    }

    const monitor = await createMonitor({
      name: name.trim(),
      url,
      check_interval_seconds: body.check_interval_seconds,
      expected_status_code: body.expected_status_code,
      timeout_ms: body.timeout_ms,
      max_failures_before_alert: body.max_failures_before_alert,
      notify_on_down: body.notify_on_down,
      notify_on_recovery: body.notify_on_recovery,
      metadata: body.metadata,
    });

    return NextResponse.json({ ok: true, monitor }, { status: 201 });
  } catch (err) {
    console.error('[api/monitors] POST error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create monitor' },
      { status: 500 }
    );
  }
}
