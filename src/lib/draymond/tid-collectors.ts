/**
 * tid-collectors.ts — Adapters that harvest and normalize signals from all
 * existing Draymond subsystems into standardized TidSignal records.
 *
 * Each collector is fail-soft: if a table/file is unavailable, it returns an empty
 * array rather than throwing, ensuring the TID engine remains resilient.
 */

import { getDb } from '@/lib/db/connection';
import { readLearningStore } from './learning-store';
import { readJsonState, nowIso } from './cognition';
import type { TidSignal } from './tid-types';

/**
 * Generate a deterministic ID for a signal based on its key properties.
 */
function createSignalId(source: string, component: string | null | undefined, metric: string, timestamp: string): string {
  const comp = component || 'global';
  const cleanTs = timestamp.replace(/[^a-zA-Z0-9]/g, '');
  return `sig_${source}_${comp}_${metric}_${cleanTs}`.slice(0, 64);
}

/**
 * 1. Benchmark Collector — extracts scores and metrics from `draymond_benchmarks`.
 */
export async function collectBenchmarkSignals(limit = 100): Promise<TidSignal[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT run_id, component_slug, component_name, component_class, weakness_score, metrics, run_at
      FROM draymond_benchmarks
      ORDER BY run_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      run_id: string;
      component_slug: string;
      component_name: string;
      component_class: string;
      weakness_score: number;
      metrics: string;
      run_at: string;
    }>;

    const signals: TidSignal[] = [];

    for (const r of rows) {
      const ts = r.run_at || nowIso();
      // Weakness score signal
      signals.push({
        id: createSignalId('benchmark', r.component_slug, 'weakness_score', ts),
        source: 'benchmark',
        category: 'performance',
        component: r.component_slug,
        metric: 'weakness_score',
        value: typeof r.weakness_score === 'number' ? r.weakness_score : 0,
        context: {
          run_id: r.run_id,
          component_name: r.component_name,
          component_class: r.component_class,
        },
        created_at: ts,
      });

      // Parse inner metrics if present (e.g. latency_p99, error_rate)
      try {
        const parsed = typeof r.metrics === 'string' ? JSON.parse(r.metrics) : r.metrics;
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.p99_ms === 'number') {
            signals.push({
              id: createSignalId('benchmark', r.component_slug, 'p99_ms', ts),
              source: 'benchmark',
              category: 'performance',
              component: r.component_slug,
              metric: 'p99_ms',
              value: parsed.p99_ms,
              context: { run_id: r.run_id },
              created_at: ts,
            });
          }
          if (typeof parsed.overall_score === 'number') {
            signals.push({
              id: createSignalId('benchmark', r.component_slug, 'overall_score', ts),
              source: 'benchmark',
              category: 'performance',
              component: r.component_slug,
              metric: 'overall_score',
              value: parsed.overall_score,
              context: { run_id: r.run_id },
              created_at: ts,
            });
          }
        }
      } catch {
        // Non-fatal parse error
      }
    }

    return signals;
  } catch (err) {
    console.warn('[tid-collectors] collectBenchmarkSignals degraded:', err);
    return [];
  }
}

/**
 * 2. Kairos Moments Collector — extracts anomaly signals from Kairos state.
 */
export async function collectKairosSignals(): Promise<TidSignal[]> {
  try {
    interface KairosStateShape {
      moments: Array<{
        id: string;
        kind: string;
        severity: 'info' | 'warn' | 'critical';
        title: string;
        detail: string;
        source: string;
        occurrences: number;
        firstSeen: string;
        lastSeen: string;
      }>;
    }

    const state = await readJsonState<KairosStateShape>('kairos', { moments: [] });
    const signals: TidSignal[] = [];

    for (const m of state.moments || []) {
      const sevWeight = m.severity === 'critical' ? 1.0 : m.severity === 'warn' ? 0.6 : 0.2;
      const ts = m.lastSeen || nowIso();

      signals.push({
        id: createSignalId('kairos', m.source || 'kairos', m.kind, ts),
        source: 'kairos',
        category: m.kind.includes('cost') || m.kind.includes('budget') ? 'cost' : 'reliability',
        component: m.source || null,
        metric: `kairos_${m.kind}`,
        value: sevWeight * Math.min(10, m.occurrences || 1),
        context: {
          moment_id: m.id,
          title: m.title,
          severity: m.severity,
          occurrences: m.occurrences,
        },
        created_at: ts,
      });
    }

    return signals;
  } catch (err) {
    console.warn('[tid-collectors] collectKairosSignals degraded:', err);
    return [];
  }
}

/**
 * 3. Repair Collector — extracts repair execution outcomes from state.
 */
export async function collectRepairSignals(): Promise<TidSignal[]> {
  try {
    interface RepairLogEntry {
      id: string;
      component: string;
      action: string;
      success: boolean;
      durationMs?: number;
      error?: string;
      timestamp: string;
    }

    const logs = await readJsonState<RepairLogEntry[]>('repair-log', []);
    const signals: TidSignal[] = [];

    for (const r of (logs || []).slice(-50)) {
      const ts = r.timestamp || nowIso();
      signals.push({
        id: createSignalId('repair', r.component, 'repair_outcome', ts),
        source: 'repair',
        category: 'self_improvement',
        component: r.component || null,
        metric: 'repair_success',
        value: r.success ? 1.0 : 0.0,
        context: {
          repair_id: r.id,
          action: r.action,
          durationMs: r.durationMs,
          error: r.error,
        },
        created_at: ts,
      });
    }

    return signals;
  } catch (err) {
    console.warn('[tid-collectors] collectRepairSignals degraded:', err);
    return [];
  }
}

/**
 * 4. Science Insights Collector — extracts cross-domain science and sports metrics from `science_insights`.
 */
export async function collectScienceSignals(limit = 50): Promise<TidSignal[]> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, source, session_id, domain, report, evidence_tier, generated_at
      FROM science_insights
      ORDER BY generated_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: string;
      source: string;
      session_id: string;
      domain: string;
      report: string;
      evidence_tier: string;
      generated_at: string;
    }>;

    const signals: TidSignal[] = [];

    for (const r of rows) {
      const ts = r.generated_at || nowIso();
      let parsedReport: Record<string, unknown> = {};
      try {
        parsedReport = typeof r.report === 'string' ? JSON.parse(r.report) : r.report;
      } catch {
        parsedReport = {};
      }

      const confidence = typeof parsedReport.confidence === 'number' ? parsedReport.confidence : 0.7;

      signals.push({
        id: createSignalId('science', r.domain || r.source, 'insight_confidence', ts),
        source: 'science',
        category: 'research',
        component: r.domain || r.source,
        metric: 'insight_confidence',
        value: confidence,
        context: {
          insight_id: r.id,
          source: r.source,
          evidence_tier: r.evidence_tier,
          from_domain: parsedReport.from_domain,
          to_domain: parsedReport.to_domain,
          archetype: parsedReport.archetype,
        },
        created_at: ts,
      });

      // If translated metrics exist, collect key indicators
      if (Array.isArray(parsedReport.translated_metrics)) {
        for (const tm of parsedReport.translated_metrics as Array<{ metric?: string; target_value?: number }>) {
          if (tm.metric && typeof tm.target_value === 'number') {
            signals.push({
              id: createSignalId('science', r.domain, `metric_${tm.metric}`, ts),
              source: 'science',
              category: 'research',
              component: r.domain,
              metric: `science_${tm.metric}`,
              value: tm.target_value,
              context: { insight_id: r.id },
              created_at: ts,
            });
          }
        }
      }
    }

    return signals;
  } catch (err) {
    console.warn('[tid-collectors] collectScienceSignals degraded:', err);
    return [];
  }
}

/**
 * 5. Execution Logs Collector — calculates operational reliability metrics.
 */
export async function collectExecutionSignals(limit = 200): Promise<TidSignal[]> {
  try {
    const db = getDb();
    // Aggregated stats by entity/agent over the last batch of executions
    const rows = db.prepare(`
      SELECT agent_id,
             COUNT(*) as total_calls,
             SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_calls,
             AVG(duration_ms) as avg_duration,
             MAX(created_at) as latest_at
      FROM draymond_execution_logs
      GROUP BY agent_id
      ORDER BY latest_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      agent_id: string;
      total_calls: number;
      success_calls: number;
      avg_duration: number;
      latest_at: string;
    }>;

    const signals: TidSignal[] = [];

    for (const r of rows) {
      if (!r.agent_id || r.total_calls === 0) continue;
      const successRate = r.success_calls / r.total_calls;
      const ts = r.latest_at || nowIso();

      signals.push({
        id: createSignalId('execution', r.agent_id, 'success_rate', ts),
        source: 'execution',
        category: 'reliability',
        component: r.agent_id,
        metric: 'execution_success_rate',
        value: Math.round(successRate * 1000) / 1000,
        context: {
          total_calls: r.total_calls,
          success_calls: r.success_calls,
        },
        created_at: ts,
      });

      if (r.avg_duration && r.avg_duration > 0) {
        signals.push({
          id: createSignalId('execution', r.agent_id, 'avg_duration_ms', ts),
          source: 'execution',
          category: 'performance',
          component: r.agent_id,
          metric: 'execution_duration_ms',
          value: Math.round(r.avg_duration),
          context: { total_calls: r.total_calls },
          created_at: ts,
        });
      }
    }

    return signals;
  } catch (err) {
    console.warn('[tid-collectors] collectExecutionSignals degraded:', err);
    return [];
  }
}

/**
 * 6. Learning Store Collector — extracts discoveries, drift metrics, and lessons.
 */
export async function collectLearningSignals(): Promise<TidSignal[]> {
  try {
    const store = await readLearningStore();
    const signals: TidSignal[] = [];

    // Discoveries
    for (const d of store.discoveries || []) {
      const ts = d.gradedAt || nowIso();
      signals.push({
        id: createSignalId('learning', d.area || d.domain, 'discovery_score', ts),
        source: 'learning',
        category: 'research',
        component: d.area || d.domain,
        metric: 'discovery_grade_score',
        value: d.score,
        context: {
          goalId: d.goalId,
          title: d.title,
          evidenceTier: d.evidenceTier,
          breakthroughClass: d.breakthroughClass,
        },
        created_at: ts,
      });
    }

    // Drift Detection
    if (store.driftMetrics) {
      const ts = store.driftMetrics.lastEvaluatedAt || nowIso();
      signals.push({
        id: createSignalId('learning', 'benchmark_facets', 'drift_magnitude', ts),
        source: 'learning',
        category: 'self_improvement',
        component: 'benchmark_facets',
        metric: 'concept_drift_magnitude',
        value: store.driftMetrics.driftMagnitude || 0,
        context: {
          conceptDriftDetected: store.driftMetrics.conceptDriftDetected,
          covariateShiftDetected: store.driftMetrics.covariateShiftDetected,
          shiftedFeatures: store.driftMetrics.shiftedFeatures,
        },
        created_at: ts,
      });
    }

    return signals;
  } catch (err) {
    console.warn('[tid-collectors] collectLearningSignals degraded:', err);
    return [];
  }
}

/**
 * Harvest all available signals concurrently across all subsystems.
 */
export async function collectAllSignals(): Promise<TidSignal[]> {
  const results = await Promise.allSettled([
    collectBenchmarkSignals(),
    collectKairosSignals(),
    collectRepairSignals(),
    collectScienceSignals(),
    collectExecutionSignals(),
    collectLearningSignals(),
  ]);

  const all: TidSignal[] = [];
  for (const res of results) {
    if (res.status === 'fulfilled') {
      all.push(...res.value);
    }
  }

  return all;
}
