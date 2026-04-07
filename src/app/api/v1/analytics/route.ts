/**
 * GET  /api/v1/analytics        — Full analytics summary for a time period
 * GET  /api/v1/analytics?view=leaderboard — Entity leaderboard
 * GET  /api/v1/analytics?view=heatmap     — Execution heatmap
 * GET  /api/v1/analytics?view=latency     — Latency percentiles
 * GET  /api/v1/analytics?view=cost        — Cost summary
 * GET  /api/v1/analytics?view=executions  — Recent execution logs
 *
 * Query params:
 *   period   — hour | day | week | month (default: day)
 *   entity_id — filter by entity (optional)
 *   limit    — max records (for leaderboard/executions, default 20)
 *
 * Auth: Bearer token checked against CRON_SECRET env var.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, sanitizeError, requireValidIds } from '@/lib/draymond/api-auth';
import {
  getAnalyticsSummary,
  getEntityLeaderboard,
  getExecutionHeatmap,
  getLatencyPercentiles,
  getCostSummary,
  getRecentExecutions,
} from '@/lib/draymond/analytics';

export const dynamic = 'force-dynamic';

type Period = 'hour' | 'day' | 'week' | 'month';

function getSinceFromPeriod(period: Period): string {
  const ms: Record<Period, number> = {
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(Date.now() - ms[period]).toISOString();
}

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const view = url.searchParams.get('view') ?? 'summary';
    const period = (url.searchParams.get('period') ?? 'day') as Period;
    const entityId = url.searchParams.get('entity_id') ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 200);

    // Validate IDs before passing to database queries
    const badId = requireValidIds({ entity_id: entityId });
    if (badId) return badId;

    if (!['hour', 'day', 'week', 'month'].includes(period)) {
      return NextResponse.json(
        { error: 'Invalid period. Must be hour, day, week, or month.' },
        { status: 400 },
      );
    }

    const since = getSinceFromPeriod(period);

    switch (view) {
      case 'summary': {
        const summary = await getAnalyticsSummary(period);
        return NextResponse.json({ summary });
      }

      case 'leaderboard': {
        const leaderboard = await getEntityLeaderboard(since, limit);
        return NextResponse.json({ leaderboard, period, since });
      }

      case 'heatmap': {
        const heatmap = await getExecutionHeatmap(since, entityId);
        return NextResponse.json({ heatmap, period, since });
      }

      case 'latency': {
        const latency = await getLatencyPercentiles(since, entityId);
        return NextResponse.json({ latency, period, since });
      }

      case 'cost': {
        const cost = await getCostSummary(since, entityId);
        return NextResponse.json({ cost, period, since });
      }

      case 'executions': {
        const executions = await getRecentExecutions({
          entity_id: entityId,
          since,
          limit,
        });
        return NextResponse.json({ executions, total: executions.length, period, since });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid view. Must be summary, leaderboard, heatmap, latency, cost, or executions.' },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error('[api/v1/analytics] GET error:', err);
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
