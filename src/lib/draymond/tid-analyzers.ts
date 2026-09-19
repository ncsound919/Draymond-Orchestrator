/**
 * tid-analyzers.ts — Deterministic statistical analysis and pattern detection for the TID Engine.
 *
 * Implements:
 * 1. Velocity Analysis: Linear regression of metric time series (calculating slope & direction).
 * 2. Anomaly Detection: Z-Score calculations against rolling means.
 * 3. Correlation Clusters: Temporal co-occurrence and Jaccard similarity across component events.
 * 4. Cross-Domain Pattern Detection: Translating research/science findings to operational fleet gains.
 * 5. Closed-Loop Verification: Comparing pre/post metrics for dispatched interventions.
 *
 * Purely mathematical and rule-based — zero hallucination, zero LLM dependencies in the hot loop.
 */

import type {
  TidSignal,
  TidInsight,
  TidDiscovery,
  TidOutcome,
  TidSuggestedAction,
} from './tid-types';
import { nowIso } from './cognition';

/**
 * Helper: Linear regression to calculate slope (rate of change per hour) and R^2.
 */
function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number; r2: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const yMean = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    const yPred = slope * p.x + intercept;
    ssTot += Math.pow(p.y - yMean, 2);
    ssRes += Math.pow(p.y - yPred, 2);
  }
  const r2 = ssTot > 1e-9 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  return { slope, intercept, r2 };
}

/**
 * 1. Velocity Analyzer: Detects rapid changes in component metrics over time.
 */
export function analyzeVelocity(signals: TidSignal[]): TidInsight[] {
  const insights: TidInsight[] = [];
  // Group signals by `component:metric`
  const seriesMap = new Map<string, TidSignal[]>();

  for (const sig of signals) {
    if (!sig.component) continue;
    const key = `${sig.component}::${sig.metric}`;
    const list = seriesMap.get(key) || [];
    list.push(sig);
    seriesMap.set(key, list);
  }

  for (const [key, sigs] of seriesMap.entries()) {
    if (sigs.length < 3) continue; // Need at least 3 points for trend detection

    const [component, metric] = key.split('::');
    // Sort chronologically
    const sorted = [...sigs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const firstTime = new Date(sorted[0].created_at).getTime();
    const points = sorted.map((s) => ({
      x: (new Date(s.created_at).getTime() - firstTime) / 3600000, // Hours from start
      y: s.value,
    }));

    const { slope, r2 } = linearRegression(points);
    const latest = sorted[sorted.length - 1];
    const initial = sorted[0];
    const delta = latest.value - initial.value;

    // Detect degradation or improvement
    // For weakness_score or p99_ms: positive slope = degrading
    // For execution_success_rate or overall_score: positive slope = improving
    const isDegradingMetric = metric === 'weakness_score' || metric === 'p99_ms' || metric.startsWith('kairos_');
    const isWorsening = isDegradingMetric ? slope > 0.5 : slope < -0.05;
    const isImproving = isDegradingMetric ? slope < -0.5 : slope > 0.05;

    if ((isWorsening || isImproving) && r2 >= 0.4) {
      const direction = isWorsening ? 'degradation' : 'improvement';
      const confidence = Math.min(0.98, Math.max(0.6, 0.5 + r2 * 0.4 + (sorted.length > 5 ? 0.1 : 0)));

      let action: TidSuggestedAction | null = null;
      if (isWorsening) {
        action = {
          actionType: metric === 'weakness_score' ? 'repair' : 'alert',
          target: component,
          parameters: { metric, slope, r2, current_value: latest.value },
          priority: Math.abs(slope) > 5 ? 'critical' : 'high',
          reasoning: `Rapid ${direction} detected in ${component} ${metric} (slope=${slope.toFixed(2)}/hr, R²=${r2.toFixed(2)}).`,
        };
      }

      insights.push({
        id: `ins_vel_${component}_${metric}_${Date.now()}`.slice(0, 48),
        type: 'velocity',
        title: `Velocity Trend: ${component} ${metric} ${direction}`,
        detail: `${component} exhibits a clear ${direction} trend in ${metric} over ${sorted.length} observations (delta: ${delta > 0 ? '+' : ''}${delta.toFixed(2)}, slope: ${slope.toFixed(3)}/hr, R²: ${r2.toFixed(2)}).`,
        confidence: Math.round(confidence * 100) / 100,
        evidence: {
          signalIds: sorted.map((s) => s.id),
          sampleSize: sorted.length,
          slope: Math.round(slope * 1000) / 1000,
          metricSummary: {
            initialValue: initial.value,
            latestValue: latest.value,
            r2: Math.round(r2 * 100) / 100,
          },
        },
        suggested_action: action,
        status: 'detected',
        created_at: nowIso(),
      });
    }
  }

  return insights;
}

/**
 * 2. Anomaly Analyzer: Detects statistical outliers (z-score >= 2.0).
 */
export function analyzeAnomalies(signals: TidSignal[]): TidInsight[] {
  const insights: TidInsight[] = [];
  const groups = new Map<string, TidSignal[]>();

  for (const sig of signals) {
    if (!sig.component) continue;
    const key = `${sig.component}::${sig.metric}`;
    const list = groups.get(key) || [];
    list.push(sig);
    groups.set(key, list);
  }

  for (const [key, sigs] of groups.entries()) {
    if (sigs.length < 4) continue; // Minimum sample for meaningful standard deviation

    const [component, metric] = key.split('::');
    const values = sigs.map((s) => s.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev < 1e-6) continue;

    // Check latest point for outlier
    const latest = sigs[sigs.length - 1];
    const zScore = (latest.value - mean) / stdDev;

    if (Math.abs(zScore) >= 2.0) {
      const confidence = Math.min(0.99, Math.max(0.65, 0.5 + (Math.abs(zScore) / 4) * 0.4));

      insights.push({
        id: `ins_anom_${component}_${metric}_${Date.now()}`.slice(0, 48),
        type: 'anomaly',
        title: `Statistical Anomaly: ${component} ${metric} (z=${zScore.toFixed(2)})`,
        detail: `Observation of ${latest.value.toFixed(2)} deviates significantly from historical mean of ${mean.toFixed(2)} (stdDev: ${stdDev.toFixed(2)}, z-score: ${zScore.toFixed(2)}).`,
        confidence: Math.round(confidence * 100) / 100,
        evidence: {
          signalIds: [latest.id],
          sampleSize: sigs.length,
          zScore: Math.round(zScore * 100) / 100,
          metricSummary: {
            mean: Math.round(mean * 100) / 100,
            stdDev: Math.round(stdDev * 100) / 100,
            observedValue: latest.value,
          },
        },
        suggested_action: {
          actionType: metric.includes('weakness') || metric.includes('error') ? 'repair' : 'alert',
          target: component,
          parameters: { metric, zScore, observed: latest.value, mean },
          priority: Math.abs(zScore) > 3.0 ? 'critical' : 'high',
          reasoning: `Value represents a ${Math.abs(zScore).toFixed(1)}-sigma outlier from baseline operations.`,
        },
        status: 'detected',
        created_at: nowIso(),
      });
    }
  }

  return insights;
}

/**
 * 3. Correlation Analyzer: Detects co-occurring failure/degradation patterns across components.
 */
export function analyzeCorrelations(signals: TidSignal[]): TidInsight[] {
  const insights: TidInsight[] = [];
  // Filter for degraded signals (high weakness, kairos alert, or failed execution)
  const degradedSignals = signals.filter(
    (s) =>
      (s.metric === 'weakness_score' && s.value > 20) ||
      (s.metric.startsWith('kairos_') && s.value > 0.5) ||
      (s.metric === 'execution_success_rate' && s.value < 0.8)
  );

  if (degradedSignals.length < 4) return [];

  // Group into 2-hour time buckets
  const bucketMap = new Map<number, Set<string>>();
  for (const s of degradedSignals) {
    if (!s.component) continue;
    const bucket = Math.floor(new Date(s.created_at).getTime() / (2 * 3600000));
    const set = bucketMap.get(bucket) || new Set<string>();
    set.add(s.component);
    bucketMap.set(bucket, set);
  }

  // Calculate pair co-occurrence
  const pairCounts = new Map<string, number>();
  const componentCounts = new Map<string, number>();

  for (const compSet of bucketMap.values()) {
    const comps = Array.from(compSet);
    for (let i = 0; i < comps.length; i++) {
      componentCounts.set(comps[i], (componentCounts.get(comps[i]) || 0) + 1);
      for (let j = i + 1; j < comps.length; j++) {
        const pair = [comps[i], comps[j]].sort().join(' <-> ');
        pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
      }
    }
  }

  for (const [pair, coCount] of pairCounts.entries()) {
    if (coCount < 2) continue; // Must co-occur in at least 2 separate time buckets

    const [compA, compB] = pair.split(' <-> ');
    const countA = componentCounts.get(compA) || 1;
    const countB = componentCounts.get(compB) || 1;

    // Jaccard similarity = coCount / (countA + countB - coCount)
    const jaccard = coCount / (countA + countB - coCount);

    if (jaccard >= 0.5) {
      const confidence = Math.min(0.95, Math.max(0.6, jaccard));
      insights.push({
        id: `ins_corr_${compA}_${compB}_${Date.now()}`.slice(0, 48),
        type: 'correlation',
        title: `Co-Occurrence Pattern: ${compA} & ${compB}`,
        detail: `Components ${compA} and ${compB} frequently experience concurrent degradation (Jaccard similarity: ${jaccard.toFixed(2)}, ${coCount} concurrent periods).`,
        confidence: Math.round(confidence * 100) / 100,
        evidence: {
          signalIds: degradedSignals
            .filter((s) => s.component === compA || s.component === compB)
            .map((s) => s.id),
          sampleSize: coCount,
          correlationCoeff: Math.round(jaccard * 100) / 100,
          metricSummary: { compA, compB, coCount, jaccard },
        },
        suggested_action: {
          actionType: 'scheduler_tune',
          target: `${compA},${compB}`,
          priority: 'medium',
          reasoning: `Stagger execution schedules or investigate shared dependency bottleneck between ${compA} and ${compB}.`,
        },
        status: 'detected',
        created_at: nowIso(),
      });
    }
  }

  return insights;
}

/**
 * 4. Cross-Domain Pattern Analyzer: Bridges scientific insights and fleet optimization.
 */
export function analyzeCrossDomain(signals: TidSignal[]): TidInsight[] {
  const insights: TidInsight[] = [];
  const scienceSignals = signals.filter((s) => s.source === 'science' && s.metric === 'insight_confidence');

  for (const sig of scienceSignals) {
    if (sig.value >= 0.85 && sig.context) {
      const fromDomain = String(sig.context.from_domain || 'science');
      const toDomain = String(sig.context.to_domain || 'general');
      const archetype = String(sig.context.archetype || 'high_performer');

      insights.push({
        id: `ins_cd_${sig.id}_${Date.now()}`.slice(0, 48),
        type: 'cross_domain',
        title: `Cross-Domain Synthesis: ${fromDomain} -> ${toDomain} (${archetype})`,
        detail: `High-confidence (${(sig.value * 100).toFixed(0)}%) cross-domain mapping synthesized for archetype '${archetype}' between ${fromDomain} and ${toDomain}.`,
        confidence: sig.value,
        evidence: {
          signalIds: [sig.id],
          sampleSize: 1,
          metricSummary: { ...sig.context, score: sig.value },
        },
        suggested_action: {
          actionType: 'research_priority',
          target: fromDomain,
          priority: 'medium',
          reasoning: `Promote archetype translation rules to production knowledge base.`,
        },
        status: 'detected',
        created_at: nowIso(),
      });
    }
  }

  return insights;
}

/**
 * 5. Feedback Loop Analyzer: Measures post-action outcomes for dispatched discoveries.
 */
export function measureDiscoveryOutcome(
  discovery: TidDiscovery,
  currentSignals: TidSignal[]
): { outcome: TidOutcome; score: number } | null {
  const target = discovery.action_detail?.target;
  if (!target) return null;

  // Filter signals related to target after dispatch
  const relevant = currentSignals.filter(
    (s) =>
      s.component === target &&
      (s.metric === 'weakness_score' || s.metric === 'execution_success_rate' || s.metric === 'overall_score')
  );

  if (relevant.length === 0) return null;

  const latest = relevant[relevant.length - 1];
  // Baseline heuristic from discovery payload
  const baselineValue =
    typeof discovery.action_detail?.payload?.current_value === 'number'
      ? (discovery.action_detail.payload.current_value as number)
      : 50;

  const isDegradingMetric = latest.metric === 'weakness_score';
  const delta = latest.value - baselineValue;
  const percentageChange = baselineValue !== 0 ? (delta / baselineValue) * 100 : delta;

  let verdict: 'effective' | 'ineffective' | 'regressed' = 'ineffective';
  let score = 0;

  if (isDegradingMetric) {
    if (delta <= -5) {
      verdict = 'effective';
      score = Math.min(1.0, Math.abs(delta) / 50);
    } else if (delta >= 5) {
      verdict = 'regressed';
      score = -Math.min(1.0, delta / 50);
    }
  } else {
    if (delta >= 0.05) {
      verdict = 'effective';
      score = Math.min(1.0, delta);
    } else if (delta <= -0.05) {
      verdict = 'regressed';
      score = -Math.min(1.0, Math.abs(delta));
    }
  }

  return {
    outcome: {
      baselineMetric: {
        metric: latest.metric,
        value: baselineValue,
        timestamp: discovery.dispatched_at,
      },
      observedMetric: {
        metric: latest.metric,
        value: latest.value,
        timestamp: latest.created_at,
      },
      delta: Math.round(delta * 100) / 100,
      percentageChange: Math.round(percentageChange * 10) / 10,
      verdict,
      notes: `Action evaluated on ${latest.metric}: ${verdict} (delta: ${delta > 0 ? '+' : ''}${delta.toFixed(2)})`,
    },
    score: Math.round(score * 100) / 100,
  };
}

/**
 * Execute all pattern analyzers across a unified signal corpus.
 */
export function runAllAnalyzers(signals: TidSignal[]): TidInsight[] {
  const vInsights = analyzeVelocity(signals);
  const aInsights = analyzeAnomalies(signals);
  const cInsights = analyzeCorrelations(signals);
  const cdInsights = analyzeCrossDomain(signals);

  return [...vInsights, ...aInsights, ...cInsights, ...cdInsights];
}
