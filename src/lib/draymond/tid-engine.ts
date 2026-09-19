/**
 * tid-engine.ts — Main orchestrator for Draymond's Trends, Insights & Discoveries System.
 *
 * Provides the unified self-improvement feedback loop:
 *   COLLECT   -> Ingest normalized signals from all fleet & science subsystems.
 *   ANALYZE   -> Deterministic statistical pattern & anomaly detection (no hot LLM).
 *   ACTION    -> Promote high-confidence insights into Discoveries and dispatch actions.
 *   MEASURE   -> Track post-intervention outcomes and feed them back as new signals.
 */

import { getDb } from '@/lib/db/connection';
import { nowIso } from './cognition';
import type {
  TidSignal,
  TidInsight,
  TidDiscovery,
  TidAnalysisReport,
  TidSignalSource,
  TidSignalCategory,
  TidInsightStatus,
  TidInsightType,
  TidDiscoveryStatus,
  TidActionType,
} from './tid-types';
import { collectAllSignals } from './tid-collectors';
import { runAllAnalyzers, measureDiscoveryOutcome } from './tid-analyzers';
import { dispatchDiscovery } from './tid-dispatcher';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;
const MAX_SIGNALS_PER_RUN = 500;

export class TidEngine {
  /**
   * Ingest a single signal into `tid_signals`.
   */
  static async ingestSignal(
    signal: Omit<TidSignal, 'id' | 'created_at'> & { id?: string; created_at?: string }
  ): Promise<TidSignal> {
    const db = getDb();
    const id = signal.id || `sig_${signal.source}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const created_at = signal.created_at || nowIso();
    const fullSignal: TidSignal = {
      ...signal,
      id,
      created_at,
    };

    try {
      db.prepare(`
        INSERT OR REPLACE INTO tid_signals (id, source, category, component, metric, value, context, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        fullSignal.id,
        fullSignal.source,
        fullSignal.category,
        fullSignal.component || null,
        fullSignal.metric,
        fullSignal.value,
        JSON.stringify(fullSignal.context || {}),
        fullSignal.created_at
      );
    } catch (err) {
      console.warn('[tid-engine] Failed to insert signal:', err);
    }

    return fullSignal;
  }

  /**
   * Batch ingest signals inside a single SQLite transaction.
   */
  static async ingestSignalsBatch(
    signals: Array<Omit<TidSignal, 'id' | 'created_at'> & { id?: string; created_at?: string }>
  ): Promise<TidSignal[]> {
    if (signals.length === 0) return [];
    const db = getDb();
    const prepared: TidSignal[] = [];

    const insert = db.prepare(`
      INSERT OR REPLACE INTO tid_signals (id, source, category, component, metric, value, context, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const runTx = db.transaction((items: TidSignal[]) => {
      for (const item of items) {
        insert.run(
          item.id,
          item.source,
          item.category,
          item.component || null,
          item.metric,
          item.value,
          JSON.stringify(item.context || {}),
          item.created_at
        );
      }
    });

    for (const s of signals) {
      prepared.push({
        ...s,
        id: s.id || `sig_${s.source}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        created_at: s.created_at || nowIso(),
      });
    }

    try {
      runTx(prepared);
    } catch (err) {
      console.warn('[tid-engine] Failed to batch insert signals:', err);
    }

    return prepared;
  }

  /**
   * Query recent signals.
   */
  static async listSignals(opts: {
    source?: TidSignalSource;
    category?: TidSignalCategory;
    component?: string;
    metric?: string;
    limit?: number;
  } = {}): Promise<TidSignal[]> {
    try {
      const db = getDb();
      const limit = Math.max(1, Math.min(1000, opts.limit ?? 100));
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (opts.source) {
        conditions.push('source = ?');
        params.push(opts.source);
      }
      if (opts.category) {
        conditions.push('category = ?');
        params.push(opts.category);
      }
      if (opts.component) {
        conditions.push('component = ?');
        params.push(opts.component);
      }
      if (opts.metric) {
        conditions.push('metric = ?');
        params.push(opts.metric);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const query = `
        SELECT id, source, category, component, metric, value, context, created_at
        FROM tid_signals
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ?
      `;
      params.push(limit);

      const rows = db.prepare(query).all(...params) as Array<{
        id: string;
        source: string;
        category: string;
        component: string | null;
        metric: string;
        value: number;
        context: string;
        created_at: string;
      }>;

      return rows.map((r) => {
        let ctx = {};
        try {
          ctx = typeof r.context === 'string' ? JSON.parse(r.context) : r.context;
        } catch {
          ctx = {};
        }
        return {
          id: r.id,
          source: r.source as TidSignalSource,
          category: r.category as TidSignalCategory,
          component: r.component,
          metric: r.metric,
          value: r.value,
          context: ctx,
          created_at: r.created_at,
        };
      });
    } catch (err) {
      console.warn('[tid-engine] listSignals failed:', err);
      return [];
    }
  }

  /**
   * Query detected insights.
   */
  static async listInsights(opts: {
    status?: TidInsightStatus;
    type?: TidInsightType;
    minConfidence?: number;
    limit?: number;
  } = {}): Promise<TidInsight[]> {
    try {
      const db = getDb();
      const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (opts.status) {
        conditions.push('status = ?');
        params.push(opts.status);
      }
      if (opts.type) {
        conditions.push('type = ?');
        params.push(opts.type);
      }
      if (typeof opts.minConfidence === 'number') {
        conditions.push('confidence >= ?');
        params.push(opts.minConfidence);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const query = `
        SELECT id, type, title, detail, confidence, evidence, suggested_action, status, created_at, promoted_at, measured_at
        FROM tid_insights
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ?
      `;
      params.push(limit);

      const rows = db.prepare(query).all(...params) as Array<{
        id: string;
        type: string;
        title: string;
        detail: string;
        confidence: number;
        evidence: string;
        suggested_action: string | null;
        status: string;
        created_at: string;
        promoted_at: string | null;
        measured_at: string | null;
      }>;

      return rows.map((r) => {
        let ev: TidInsight['evidence'] = { signalIds: [], sampleSize: 0 };
        let action: TidInsight['suggested_action'] = null;
        try {
          ev = JSON.parse(r.evidence);
        } catch {}
        try {
          if (r.suggested_action) action = JSON.parse(r.suggested_action);
        } catch {}

        return {
          id: r.id,
          type: r.type as TidInsightType,
          title: r.title,
          detail: r.detail,
          confidence: r.confidence,
          evidence: ev,
          suggested_action: action,
          status: r.status as TidInsightStatus,
          created_at: r.created_at,
          promoted_at: r.promoted_at,
          measured_at: r.measured_at,
        };
      });
    } catch (err) {
      console.warn('[tid-engine] listInsights failed:', err);
      return [];
    }
  }

  /**
   * Query promoted discoveries.
   */
  static async listDiscoveries(opts: {
    status?: TidDiscoveryStatus;
    actionType?: TidActionType;
    limit?: number;
  } = {}): Promise<TidDiscovery[]> {
    try {
      const db = getDb();
      const limit = Math.max(1, Math.min(500, opts.limit ?? 50));
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (opts.status) {
        conditions.push('status = ?');
        params.push(opts.status);
      }
      if (opts.actionType) {
        conditions.push('action_type = ?');
        params.push(opts.actionType);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const query = `
        SELECT id, insight_id, action_type, action_detail, dispatched_at, outcome, outcome_score, measured_at, status
        FROM tid_discoveries
        ${whereClause}
        ORDER BY dispatched_at DESC
        LIMIT ?
      `;
      params.push(limit);

      const rows = db.prepare(query).all(...params) as Array<{
        id: string;
        insight_id: string;
        action_type: string;
        action_detail: string;
        dispatched_at: string;
        outcome: string | null;
        outcome_score: number | null;
        measured_at: string | null;
        status: string;
      }>;

      return rows.map((r) => {
        let detail: TidDiscovery['action_detail'] = { description: '', dispatchedBy: 'tid-engine' };
        let outcome: TidDiscovery['outcome'] = null;
        try {
          detail = JSON.parse(r.action_detail);
        } catch {}
        try {
          if (r.outcome) outcome = JSON.parse(r.outcome);
        } catch {}

        return {
          id: r.id,
          insight_id: r.insight_id,
          action_type: r.action_type as TidActionType,
          action_detail: detail,
          dispatched_at: r.dispatched_at,
          outcome,
          outcome_score: r.outcome_score,
          measured_at: r.measured_at,
          status: r.status as TidDiscoveryStatus,
        };
      });
    } catch (err) {
      console.warn('[tid-engine] listDiscoveries failed:', err);
      return [];
    }
  }

  /**
   * Run a full TID closed-loop cycle.
   */
  static async runAnalysisCycle(opts: {
    confidenceThreshold?: number;
    autoDispatch?: boolean;
  } = {}): Promise<TidAnalysisReport> {
    const started = Date.now();
    const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const autoDispatch = opts.autoDispatch ?? true;

    // 1. COLLECT: Harvest latest signals across all subsystems
    const freshSignals = await collectAllSignals();
    if (freshSignals.length > 0) {
      await TidEngine.ingestSignalsBatch(freshSignals);
    }

    // 2. Load recent signal window from database
    const windowSignals = await TidEngine.listSignals({ limit: MAX_SIGNALS_PER_RUN });

    // 3. ANALYZE: Run deterministic statistical analyzers
    const rawInsights = runAllAnalyzers(windowSignals);

    // 4. Persist insights into `tid_insights`
    const db = getDb();
    const now = nowIso();
    const insights: TidInsight[] = [];
    const discoveries: TidDiscovery[] = [];
    let promotedCount = 0;
    let dispatchedCount = 0;

    for (const ins of rawInsights) {
      try {
        const existing = db
          .prepare(`SELECT id, status FROM tid_insights WHERE id = ?`)
          .get(ins.id) as { id: string; status: string } | undefined;

        if (!existing) {
          db.prepare(`
            INSERT INTO tid_insights (id, type, title, detail, confidence, evidence, suggested_action, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            ins.id,
            ins.type,
            ins.title,
            ins.detail,
            ins.confidence,
            JSON.stringify(ins.evidence),
            ins.suggested_action ? JSON.stringify(ins.suggested_action) : null,
            'detected',
            now
          );
          insights.push(ins);

          // 5. ACTION: Promote high-confidence insights to Discoveries
          if (ins.confidence >= threshold && ins.suggested_action) {
            promotedCount++;
            const discoveryId = `disc_${ins.id.replace(/^ins_/, '')}`;
            const actionType = ins.suggested_action.actionType;
            const actionDetail = {
              target: ins.suggested_action.target,
              description: ins.suggested_action.reasoning,
              payload: ins.suggested_action.parameters,
              dispatchedBy: 'tid-engine',
            };

            const discovery: TidDiscovery = {
              id: discoveryId,
              insight_id: ins.id,
              action_type: actionType,
              action_detail: actionDetail,
              dispatched_at: now,
              status: 'dispatched',
            };

            db.prepare(`
              INSERT OR REPLACE INTO tid_discoveries (id, insight_id, action_type, action_detail, dispatched_at, status)
              VALUES (?, ?, ?, ?, ?, 'dispatched')
            `).run(
              discovery.id,
              discovery.insight_id,
              discovery.action_type,
              JSON.stringify(discovery.action_detail),
              discovery.dispatched_at
            );

            // Mark insight as promoted
            db.prepare(`UPDATE tid_insights SET status = 'promoted', promoted_at = ? WHERE id = ?`).run(now, ins.id);

            // Dispatch action if enabled
            if (autoDispatch) {
              await dispatchDiscovery(discovery);
              dispatchedCount++;
            }

            discoveries.push(discovery);
          }
        }
      } catch (err) {
        console.warn('[tid-engine] Error processing insight %s:', ins.id, err);
      }
    }

    // 6. MEASURE: Evaluate past dispatched discoveries against current signals
    let measuredCount = 0;
    const pendingDiscoveries = await TidEngine.listDiscoveries({ status: 'dispatched', limit: 20 });

    for (const disc of pendingDiscoveries) {
      const evaluation = measureDiscoveryOutcome(disc, windowSignals);
      if (evaluation) {
        measuredCount++;
        const { outcome, score } = evaluation;
        const newStatus: TidDiscoveryStatus = outcome.verdict;

        db.prepare(`
          UPDATE tid_discoveries
          SET outcome = ?, outcome_score = ?, measured_at = ?, status = ?
          WHERE id = ?
        `).run(
          JSON.stringify(outcome),
          score,
          now,
          newStatus,
          disc.id
        );

        // Also update the linked insight status
        db.prepare(`UPDATE tid_insights SET status = 'measured', measured_at = ? WHERE id = ?`).run(
          now,
          disc.insight_id
        );

        // FEEDBACK: Ingest the measurement outcome as a new signal
        await TidEngine.ingestSignal({
          source: 'feedback',
          category: 'self_improvement',
          component: disc.action_detail?.target || 'general',
          metric: 'intervention_outcome_score',
          value: score,
          context: {
            discoveryId: disc.id,
            actionType: disc.action_type,
            verdict: outcome.verdict,
            delta: outcome.delta,
          },
        });
      }
    }

    const report: TidAnalysisReport = {
      timestamp: now,
      signalsProcessed: windowSignals.length,
      insightsGenerated: insights.length,
      discoveriesPromoted: promotedCount,
      actionsDispatched: dispatchedCount,
      outcomesMeasured: measuredCount,
      durationMs: Date.now() - started,
      insights,
      discoveries,
    };

    return report;
  }
}
