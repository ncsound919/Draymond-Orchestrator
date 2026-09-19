/**
 * tid-types.ts — Type definitions for Draymond's Trends, Insights & Discoveries (TID) Engine.
 *
 * Closed-loop intelligence pipeline:
 *   Phase 1: Ingest normalized signals (TidSignal) from all fleet & science producers.
 *   Phase 2: Detect deterministic trends & patterns (TidInsight).
 *   Phase 3: Dispatch actionable discoveries (TidDiscovery) to repair, tuning, alerts.
 *   Phase 4: Measure outcomes (TidOutcome) and feed them back as new signals.
 */

export type TidSignalSource =
  | 'benchmark'
  | 'kairos'
  | 'repair'
  | 'science'
  | 'execution'
  | 'learning'
  | 'synthesis'
  | 'feedback';

export type TidSignalCategory =
  | 'performance'
  | 'reliability'
  | 'cost'
  | 'research'
  | 'security'
  | 'self_improvement';

export interface TidSignal {
  id: string;
  source: TidSignalSource;
  category: TidSignalCategory;
  component?: string | null; // e.g. 'litellm-gateway', 'oncology', or null for cross-cutting
  metric: string;            // e.g. 'weakness_score', 'latency_p99', 'success_rate', 'breakthrough_score'
  value: number;
  context?: Record<string, unknown>;
  created_at: string;
}

export type TidInsightType =
  | 'velocity'       // Rapid improvement or degradation trend
  | 'correlation'    // Co-occurring patterns across components/subsystems
  | 'anomaly'        // Statistical deviation (z-score) from rolling mean
  | 'cross_domain'   // Science ↔ Operational insight bridge
  | 'feedback_loop'; // Post-intervention outcome verification

export type TidInsightStatus =
  | 'detected'
  | 'promoted'
  | 'dispatched'
  | 'measured'
  | 'archived';

export interface TidSuggestedAction {
  actionType: TidActionType;
  target?: string;
  parameters?: Record<string, unknown>;
  priority: 'low' | 'medium' | 'high' | 'critical';
  reasoning: string;
}

export interface TidInsight {
  id: string;
  type: TidInsightType;
  title: string;
  detail: string;
  confidence: number; // 0.0 to 1.0
  evidence: {
    signalIds: string[];
    sampleSize: number;
    metricSummary?: Record<string, unknown>;
    zScore?: number;
    correlationCoeff?: number;
    slope?: number;
  };
  suggested_action?: TidSuggestedAction | null;
  status: TidInsightStatus;
  created_at: string;
  promoted_at?: string | null;
  measured_at?: string | null;
}

export type TidActionType =
  | 'repair'            // Dispatch to repair-team
  | 'weight_update'     // Update self-learning / grader weights
  | 'scheduler_tune'    // Adjust cron frequency or budget
  | 'alert'             // Push critical notification
  | 'research_priority' // Prioritize scientific goal / gap
  | 'custom';

export type TidDiscoveryStatus =
  | 'dispatched'
  | 'measured'
  | 'effective'
  | 'ineffective'
  | 'regressed';

export interface TidDiscovery {
  id: string;
  insight_id: string;
  action_type: TidActionType;
  action_detail: {
    target?: string;
    description: string;
    payload?: Record<string, unknown>;
    dispatchedBy: string;
  };
  dispatched_at: string;
  outcome?: TidOutcome | null;
  outcome_score?: number | null; // -1.0 (severe regression) to +1.0 (major breakthrough/gain)
  measured_at?: string | null;
  status: TidDiscoveryStatus;
}

export interface TidOutcome {
  baselineMetric: { metric: string; value: number; timestamp: string };
  observedMetric: { metric: string; value: number; timestamp: string };
  delta: number;
  percentageChange: number;
  verdict: 'effective' | 'ineffective' | 'regressed';
  notes?: string;
}

export interface TidTrendSummary {
  component?: string;
  metric: string;
  dataPoints: number;
  firstTimestamp: string;
  lastTimestamp: string;
  currentValue: number;
  mean: number;
  standardDeviation: number;
  slope: number; // rate of change per hour
  direction: 'improving' | 'degrading' | 'stable';
  zScore: number;
}

export interface TidAnalysisReport {
  timestamp: string;
  signalsProcessed: number;
  insightsGenerated: number;
  discoveriesPromoted: number;
  actionsDispatched: number;
  outcomesMeasured: number;
  durationMs: number;
  insights: TidInsight[];
  discoveries: TidDiscovery[];
}
