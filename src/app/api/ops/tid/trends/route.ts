import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { TidEngine } from '@/lib/draymond/tid-engine';
import type { TidSignal, TidTrendSummary } from '@/lib/draymond/tid-types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/tid/trends — per `component::metric` trend summaries.
 *
 * The TID analyzers compute these internally during a cycle; this surfaces the
 * same deterministic statistics (mean, sd, slope/hr, z-score, direction) over
 * the stored signals so fleet peers (e.g. Recourse) can read them without
 * re-implementing the math. Query: source, category, component, metric, limit.
 * Auth: Bearer CRON_SECRET.
 */

function directionFor(metric: string, slope: number, stableBand: number): TidTrendSummary['direction'] {
  // For degradation metrics a rising slope is bad; for improvement metrics it is good.
  const isDegradingMetric = metric === 'weakness_score' || metric === 'p99_ms' || metric.startsWith('kairos_');
  if (Math.abs(slope) <= stableBand) return 'stable';
  const worsening = isDegradingMetric ? slope > 0 : slope < 0;
  return worsening ? 'degrading' : 'improving';
}

function summarize(signals: TidSignal[]): TidTrendSummary[] {
  const groups = new Map<string, TidSignal[]>();
  for (const s of signals) {
    if (!s.component) continue;
    const key = `${s.component}::${s.metric}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  const out: TidTrendSummary[] = [];
  for (const [key, sigs] of groups.entries()) {
    if (sigs.length < 2) continue;
    const [component, metric] = key.split('::');
    const sorted = [...sigs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const firstTime = new Date(sorted[0].created_at).getTime();
    const hours = sorted.map((s) => (new Date(s.created_at).getTime() - firstTime) / 3_600_000);
    const values = sorted.map((s) => s.value);
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const standardDeviation = Math.sqrt(variance);

    // Least-squares slope (rate per hour).
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += hours[i]; sumY += values[i]; sumXY += hours[i] * values[i]; sumX2 += hours[i] * hours[i];
    }
    const denom = n * sumX2 - sumX * sumX;
    const slope = Math.abs(denom) < 1e-9 ? 0 : (n * sumXY - sumX * sumY) / denom;
    const currentValue = values[n - 1];
    const zScore = standardDeviation === 0 ? 0 : (currentValue - mean) / standardDeviation;
    const stableBand = standardDeviation === 0 ? 0.05 : 0.05 / Math.max(1e-9, standardDeviation);

    out.push({
      component,
      metric,
      dataPoints: n,
      firstTimestamp: sorted[0].created_at,
      lastTimestamp: sorted[n - 1].created_at,
      currentValue: Math.round(currentValue * 1000) / 1000,
      mean: Math.round(mean * 1000) / 1000,
      standardDeviation: Math.round(standardDeviation * 1000) / 1000,
      slope: Math.round(slope * 1000) / 1000,
      direction: directionFor(metric, slope, stableBand),
      zScore: Math.round(zScore * 1000) / 1000,
    });
  }
  return out.sort((a, b) => (a.component ?? '').localeCompare(b.component ?? '') || a.metric.localeCompare(b.metric));
}

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const sp = request.nextUrl.searchParams;
    const limit = Math.max(1, Math.min(1000, Number(sp.get('limit')) || 500));
    const signals = await TidEngine.listSignals({
      component: sp.get('component') || undefined,
      metric: sp.get('metric') || undefined,
      limit,
    });
    const trends = summarize(signals);
    return NextResponse.json({ ok: true, count: trends.length, trends });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
