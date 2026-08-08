import { NextRequest, NextResponse } from 'next/server';
import { authorizeMetricsRequest } from '@/lib/draymond/api-auth';
import { renderMetrics } from '@/lib/draymond/metrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/ops/metrics — Prometheus text exposition of orchestrator health.
 * Auth: Bearer METRICS_TOKEN (or CRON_SECRET). Scrape with:
 *   scrape_configs:
 *     - job_name: draymond
 *       metrics_path: /api/ops/metrics
 *       bearer_token_file: /path/to/metrics-token
 *       scheme: https
 *       static_configs: [{ targets: ['your-draymond-instance.com'] }]
 */
export async function GET(request: NextRequest) {
  const authError = authorizeMetricsRequest(request);
  if (authError) return authError;
  try {
    const text = await renderMetrics();
    return new NextResponse(text, {
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[metrics] render failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Metrics unavailable' }, { status: 500 });
  }
}
