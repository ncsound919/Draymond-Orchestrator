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
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
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
      const parsed = parseInt(limitParam, 10);
      filters.limit = isNaN(parsed) ? 100 : Math.min(Math.max(parsed, 1), 500);
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
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const bodyResult = await parseJsonBody<Record<string, unknown>>(request);
    if (bodyResult.error) return bodyResult.error;
    const body = bodyResult.data;
    const { name, url } = body as { name?: string; url?: string };

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
      check_interval_seconds: typeof body.check_interval_seconds === 'number' ? body.check_interval_seconds : undefined,
      expected_status_code: typeof body.expected_status_code === 'number' ? body.expected_status_code : undefined,
      timeout_ms: typeof body.timeout_ms === 'number' ? body.timeout_ms : undefined,
      max_failures_before_alert: typeof body.max_failures_before_alert === 'number' ? body.max_failures_before_alert : undefined,
      notify_on_down: typeof body.notify_on_down === 'boolean' ? body.notify_on_down : undefined,
      notify_on_recovery: typeof body.notify_on_recovery === 'boolean' ? body.notify_on_recovery : undefined,
      metadata: (typeof body.metadata === 'object' && body.metadata !== null && !Array.isArray(body.metadata))
        ? body.metadata as Record<string, unknown>
        : undefined,
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
