// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Core Service Library
// ============================================================================
// This is the brain of the supervision layer. It provides:
// 1. Agent Health Monitoring & Auto-Recovery
// 2. Confidence-Gated Action Execution
// 3. Tiered Memory Management with Decay & Isolation
// 4. Full Audit Trail & Explainability Logging
// 5. Multi-Agent Handoff Protocol
// 6. Goal Management & Enforcement
// ============================================================================

import { createDraymondClient, createDraymondAdminClient } from './client';
import { randomBytes } from 'crypto';
import { after } from 'next/server';
import { publishApprovalNotification } from './ntfy';
import type {
  AgentStatus,
  ActionRiskLevel,
  ConfidenceDecision,
  AgentHealthReport,
  DraymondAgent,
  DraymondAction,
  DraymondEventInsert,
  DraymondMemoryInsert,
  DraymondActionInsert,
  DraymondHandoffInsert,
  DraymondDashboardSummary,
  MemoryTier,
  EventCategory,
  EventSeverity,
} from './types';

// ============================================================================
// 1. AGENT HEALTH MONITORING & AUTO-RECOVERY
// Solves: Single-Agent Fragility
// ============================================================================

/** TTL for action review tokens (48 hours). */
const REVIEW_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Record an agent heartbeat, resetting its consecutive error count
 */
export async function recordHeartbeat(agentId: string): Promise<void> {
  const supabase = await createDraymondClient();

  const { error } = await supabase
    .from('draymond_agents')
    .update({
      last_heartbeat: new Date().toISOString(),
      consecutive_errors: 0,
      status: 'active' as AgentStatus,
    })
    .eq('id', agentId);

  if (error) throw new Error(`Heartbeat failed for agent ${agentId}: ${error.message}`);
}

/**
 * Record an agent error and check if recovery is needed
 */
export async function recordAgentError(
  agentId: string,
  errorMessage: string,
  sessionId?: string
): Promise<{ shouldRecover: boolean; shouldFailover: boolean }> {
  const supabase = await createDraymondClient();

  // Get current agent state
  const { data: agent, error: fetchError } = await supabase
    .from('draymond_agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (fetchError || !agent) throw new Error(`Agent ${agentId} not found`);

  const typedAgent = agent as DraymondAgent;
  const newErrorCount = typedAgent.consecutive_errors + 1;
  const shouldRecover = newErrorCount >= typedAgent.max_consecutive_errors;
  const shouldFailover = shouldRecover && !!typedAgent.fallback_agent_id;

  // Update agent state
  const newStatus: AgentStatus = shouldRecover
    ? shouldFailover
      ? 'crashed'
      : 'recovering'
    : newErrorCount >= Math.ceil(typedAgent.max_consecutive_errors / 2)
      ? 'degraded'
      : 'active';

  const { error: updateError } = await supabase
    .from('draymond_agents')
    .update({
      consecutive_errors: newErrorCount,
      status: newStatus,
    })
    .eq('id', agentId);

  if (updateError) {
    console.error(`[Draymond] Failed to update agent error state: ${updateError.message}`);
  }

  // Log the error event
  await logEvent({
    agent_id: agentId,
    session_id: sessionId,
    category: 'health',
    severity: shouldRecover ? 'critical' : 'error',
    event_type: shouldRecover ? 'agent_recovery_triggered' : 'agent_error',
    message: errorMessage,
    metadata: {
      consecutive_errors: newErrorCount,
      max_errors: typedAgent.max_consecutive_errors,
      will_recover: shouldRecover,
      will_failover: shouldFailover,
    },
  });

  return { shouldRecover, shouldFailover };
}

/**
 * Get health reports for all agents
 */
export async function getAgentHealthReports(): Promise<AgentHealthReport[]> {
  const supabase = await createDraymondClient();

  const { data: agents, error } = await supabase
    .from('draymond_agents')
    .select('*')
    .order('name');

  if (error) throw new Error(`Failed to fetch agents: ${error.message}`);
  if (!agents) return [];

  // Get active session counts
  const { data: sessionCounts } = await supabase
    .from('draymond_sessions')
    .select('agent_id')
    .eq('is_active', true);

  const sessionCountMap = new Map<string, number>();
  (sessionCounts || []).forEach((s: { agent_id: string }) => {
    sessionCountMap.set(s.agent_id, (sessionCountMap.get(s.agent_id) || 0) + 1);
  });

  return (agents as DraymondAgent[]).map((agent) => {
    const secondsSinceHeartbeat = agent.last_heartbeat
      ? (Date.now() - new Date(agent.last_heartbeat).getTime()) / 1000
      : null;

    const isHealthy =
      agent.status === 'active' &&
      agent.consecutive_errors === 0 &&
      (secondsSinceHeartbeat === null ||
        secondsSinceHeartbeat < agent.heartbeat_interval_seconds * 3);

    let recommendation: AgentHealthReport['recommendation'] = 'none';
    if (agent.status === 'crashed' || agent.status === 'stalled') {
      recommendation = agent.fallback_agent_id ? 'failover' : 'recover';
    } else if (agent.status === 'degraded') {
      recommendation = 'investigate';
    } else if (
      secondsSinceHeartbeat !== null &&
      secondsSinceHeartbeat > agent.heartbeat_interval_seconds * 2
    ) {
      recommendation = 'monitor';
    }

    return {
      agent_id: agent.id,
      agent_name: agent.name,
      status: agent.status,
      last_heartbeat: agent.last_heartbeat,
      seconds_since_heartbeat: secondsSinceHeartbeat,
      consecutive_errors: agent.consecutive_errors,
      is_healthy: isHealthy,
      active_sessions: sessionCountMap.get(agent.id) || 0,
      recommendation,
    };
  });
}

/**
 * Initiate auto-recovery for a failed agent
 */
export async function initiateRecovery(
  agentId: string,
  sessionId?: string
): Promise<{ recovered: boolean; failoverAgentId?: string }> {
  const supabase = await createDraymondClient();

  const { data: agent } = await supabase
    .from('draymond_agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const typedAgent = agent as DraymondAgent;

  // If there's a fallback agent, initiate handoff
  if (typedAgent.fallback_agent_id) {
    await initiateHandoff({
      source_agent_id: agentId,
      source_session_id: sessionId,
      target_agent_id: typedAgent.fallback_agent_id,
      reason: `Auto-failover: Agent "${typedAgent.name}" exceeded ${typedAgent.max_consecutive_errors} consecutive errors`,
    });

    await logEvent({
      agent_id: agentId,
      session_id: sessionId,
      category: 'recovery',
      severity: 'warning',
      event_type: 'failover_initiated',
      message: `Failing over to agent ${typedAgent.fallback_agent_id}`,
      reasoning: `Agent exceeded maximum consecutive errors (${typedAgent.consecutive_errors}/${typedAgent.max_consecutive_errors})`,
    });

    return { recovered: false, failoverAgentId: typedAgent.fallback_agent_id };
  }

  // Otherwise, attempt self-recovery (reset state)
  if (typedAgent.auto_recovery_enabled) {
    const { error: recoveryError } = await supabase
      .from('draymond_agents')
      .update({
        status: 'active' as AgentStatus,
        consecutive_errors: 0,
        last_heartbeat: new Date().toISOString(),
      })
      .eq('id', agentId);

    if (recoveryError) {
      console.error(`[Draymond] Failed to update agent recovery state: ${recoveryError.message}`);
    }

    await logEvent({
      agent_id: agentId,
      session_id: sessionId,
      category: 'recovery',
      severity: 'info',
      event_type: 'self_recovery_completed',
      message: 'Agent self-recovered by resetting error state',
    });

    return { recovered: true };
  }

  return { recovered: false };
}

// ============================================================================
// 2. CONFIDENCE-GATED ACTION EXECUTION
// Solves: Hallucination Cascades, Oversight Gap
// ============================================================================

/** Maximum threshold cap — prevents setting impossible thresholds (score can't exceed 1.0). */
const MAX_CONFIDENCE_THRESHOLD = 0.999;

/**
 * Risk level multipliers for confidence thresholds.
 * Higher risk actions need higher confidence to auto-execute.
 */
const RISK_MULTIPLIERS: Record<ActionRiskLevel, number> = {
  safe: 0.8,
  low: 0.9,
  medium: 1.0,
  high: 1.15,
  critical: 1.3,
};

/**
 * Evaluate whether an action should auto-execute, queue for review, or be blocked
 */
export function evaluateConfidence(
  confidenceScore: number,
  riskLevel: ActionRiskLevel,
  thresholdAuto: number,
  thresholdReview: number
): ConfidenceDecision {
  if (!Number.isFinite(confidenceScore) || confidenceScore < 0 || confidenceScore > 1) {
    console.warn(`[Draymond] Invalid confidence score: ${confidenceScore}, defaulting to 0`);
    confidenceScore = 0;
  }

  const multiplier = RISK_MULTIPLIERS[riskLevel];
  const adjustedAutoThreshold = Math.min(thresholdAuto * multiplier, MAX_CONFIDENCE_THRESHOLD);
  const adjustedReviewThreshold = Math.min(thresholdReview * multiplier, adjustedAutoThreshold);

  let action: ConfidenceDecision['action'];
  let reasoning: string;

  if (confidenceScore >= adjustedAutoThreshold) {
    action = 'auto_execute';
    reasoning = `Confidence ${confidenceScore.toFixed(3)} >= adjusted auto-threshold ${adjustedAutoThreshold.toFixed(3)} (base ${thresholdAuto} * ${riskLevel} multiplier ${multiplier})`;
  } else if (confidenceScore >= adjustedReviewThreshold) {
    action = 'queue_for_review';
    reasoning = `Confidence ${confidenceScore.toFixed(3)} is between review threshold ${adjustedReviewThreshold.toFixed(3)} and auto threshold ${adjustedAutoThreshold.toFixed(3)} — queuing for human review`;
  } else {
    action = 'block';
    reasoning = `Confidence ${confidenceScore.toFixed(3)} < adjusted review threshold ${adjustedReviewThreshold.toFixed(3)} — action blocked`;
  }

  return {
    action,
    confidence_score: confidenceScore,
    threshold_auto: adjustedAutoThreshold,
    threshold_review: adjustedReviewThreshold,
    risk_level: riskLevel,
    reasoning,
  };
}

/**
 * Submit an action through the confidence gate.
 * Returns the action record with its gating decision.
 */
export async function submitAction(
  input: DraymondActionInsert
): Promise<{ action: DraymondAction; decision: ConfidenceDecision }> {
  const supabase = createDraymondAdminClient();

  // Get agent configuration for thresholds
  const { data: agent } = await supabase
    .from('draymond_agents')
    .select('confidence_threshold_auto, confidence_threshold_review, name')
    .eq('id', input.agent_id)
    .single();

  if (!agent) throw new Error(`Agent ${input.agent_id} not found`);

  const decision = evaluateConfidence(
    input.confidence_score,
    input.risk_level || 'low',
    agent.confidence_threshold_auto,
    agent.confidence_threshold_review
  );

  // Set status based on confidence decision
  const status =
    decision.action === 'auto_execute'
      ? 'auto_executed'
      : decision.action === 'queue_for_review'
        ? 'pending_review'
        : 'rejected';

  const requiresReview = decision.action === 'queue_for_review';

  // Per-action review token for ntfy push approval. Only minted when the
  // action actually needs human review — never exposed on auto-executed work.
  const reviewToken = requiresReview ? randomBytes(32).toString('hex') : null;
  const reviewTokenExpiresAt = reviewToken
    ? new Date(Date.now() + REVIEW_TOKEN_TTL_MS).toISOString()
    : null;

  const { data: actionRecord, error } = await supabase
    .from('draymond_actions')
    .insert({
      agent_id: input.agent_id,
      session_id: input.session_id,
      user_id: input.user_id,
      action_type: input.action_type,
      description: input.description,
      payload: input.payload || {},
      confidence_score: input.confidence_score,
      risk_level: input.risk_level || 'low',
      confidence_reasoning: decision.reasoning,
      status,
      requires_human_review: requiresReview,
      review_token: reviewToken,
      review_token_expires_at: reviewTokenExpiresAt,
      goal_id: input.goal_id,
      goal_alignment_score: input.goal_alignment_score,
      expires_at: input.expires_at,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to submit action: ${error.message}`);

  // Fire-and-forget the ntfy push. A notification failure must never fail
  // the action submission itself. Run post-response via `after()` when in a
  // request scope (bare fire-and-forget promises can be terminated early in
  // serverless), otherwise fall back to a detached promise.
  if (requiresReview) {
    const publish = (): Promise<void> => {
      publishApprovalNotification(actionRecord as DraymondAction)
        .catch((err) => {
          console.warn('[ntfy] publishApprovalNotification failed:', err);
        });
      return Promise.resolve();
    };
    try {
      after(publish);
    } catch {
      publish();
    }
  }

  // Log the confidence decision
  await logEvent({
    agent_id: input.agent_id,
    session_id: input.session_id,
    user_id: input.user_id,
    category: 'confidence',
    severity: decision.action === 'block' ? 'warning' : 'info',
    event_type: `action_${decision.action}`,
    message: `Action "${input.action_type}" — ${decision.reasoning}`,
    context_used: { action_type: input.action_type, risk_level: input.risk_level },
    reasoning: decision.reasoning,
    metadata: { action_id: actionRecord.id, decision },
  });

  return { action: actionRecord as DraymondAction, decision };
}

/**
 * Review a pending action (approve or reject)
 */
export async function reviewAction(
  actionId: string,
  reviewerId: string,
  approved: boolean,
  notes?: string
): Promise<DraymondAction> {
  const supabase = createDraymondAdminClient();

  const { data: action, error } = await supabase
    .from('draymond_actions')
    .update({
      status: approved ? 'approved' : 'rejected',
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_notes: notes,
    })
    .eq('id', actionId)
    .eq('status', 'pending_review')
    .select()
    .single();

  if (error) throw new Error(`Failed to review action: ${error.message}`);

  const typedAction = action as DraymondAction;

  await logEvent({
    agent_id: typedAction.agent_id,
    session_id: typedAction.session_id || undefined,
    user_id: typedAction.user_id || undefined,
    category: 'human_review',
    severity: 'info',
    event_type: approved ? 'action_approved' : 'action_rejected',
    message: `Action "${typedAction.action_type}" ${approved ? 'approved' : 'rejected'} by reviewer`,
    reasoning: notes || undefined,
    metadata: { action_id: actionId, reviewer_id: reviewerId },
  });

  // On approval, schedule the action's execution after the response is sent.
  // The chain-step resume can run up to DEFAULT_CHAIN_TIMEOUT_MS (5 min),
  // far beyond the route's maxDuration — so it must not be awaited inline.
  if (approved) {
    await scheduleApprovedActionExecution(typedAction);
  }

  return typedAction;
}

/**
 * Check whether an action has already been approved. Used by the chain
 * confidence gate to bypass re-queueing a step whose action was approved.
 */
export async function isActionApproved(actionId: string | null): Promise<boolean> {
  if (!actionId) return false;
  const supabase = createDraymondAdminClient();
  const { data, error } = await supabase
    .from('draymond_actions')
    .select('status')
    .eq('id', actionId)
    .maybeSingle();
  if (error || !data) return false;
  return data.status === 'approved';
}

/**
 * Execute an approved action.
 *
 * Chain-step actions (action_type `chain_step:*`) are linked to a
 * `draymond_chain_steps` row via `action_id`. Approving one resumes the
 * parent chain from the pending step. The chain was left in `failed` status
 * when the step queued for review, so `resumeChain` accepts it and resets
 * non-terminal steps to `pending` before re-running.
 *
 * Standalone actions just record execution — their payload is consumed by the
 * caller.
 *
 * Scheduling: the resume may take up to 5 minutes, so it runs via
 * `after()` (post-response) rather than inline. Falls back to a fire-and-
 * forget promise when `after()` is unavailable (non-request context). On
 * failure, the fact is written to `result.resume_failed` so the dashboard can
 * surface "approved but resume failed — retry".
 *
 * Dynamic import avoids a circular dependency (chains.ts imports this file).
 */
async function scheduleApprovedActionExecution(action: DraymondAction): Promise<void> {
  const isChainStep = action.action_type?.startsWith('chain_step:') ?? false;

  const run = async (): Promise<void> => {
    let chainId: string | null = null;
    try {
      // AetherDesk actions execute asynchronously via the AetherDesk REST
      // executor, then record their own result and publish to the results
      // ntfy topic. Fire-and-forget; return before the generic chain-step /
      // standalone "mark completed / record" logic so the action is not
      // double-processed.
      if (action.action_type?.startsWith('aetherdesk:')) {
        const { executeApprovedAetherDeskAction } = await import('./aetherdesk');
        executeApprovedAetherDeskAction(action.id).catch(() => {});
        return;
      }

      if (isChainStep) {
        const { resumeChain } = await import('./chains');
        const { data: step } = await (
          await createDraymondClient()
        )
          .from('draymond_chain_steps')
          .select('chain_id')
          .eq('action_id', action.id)
          .maybeSingle();
        chainId = step?.chain_id ?? null;

        if (chainId) {
          await resumeChain(chainId, action.agent_id, { timeout_ms: 300000 });
        }
      }

      const supabase = await createDraymondClient();
      await supabase
        .from('draymond_actions')
        .update({
          executed_at: new Date().toISOString(),
          result: isChainStep
            ? { chain_id: chainId, resumed: true }
            : { status: 'recorded' },
          error_message: undefined,
        })
        .eq('id', action.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const supabase = await createDraymondClient();
      await supabase
        .from('draymond_actions')
        .update({
          result: { resume_failed: true, chain_id: chainId, error: message },
          error_message: `Chain resume failed: ${message}`,
        })
        .eq('id', action.id);
    }
  };

  try {
    after(run);
  } catch {
    // Not in a request scope — fire and forget rather than throwing inline.
    run().catch(() => {});
  }
}

/**
 * Get all pending actions awaiting human review.
 * Sensitive fields (review_token / review_token_expires_at) are stripped so
 * single-use review tokens never reach the browser.
 */
export async function getPendingActions(): Promise<DraymondAction[]> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_actions')
    .select('*')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch pending actions: ${error.message}`);
  return ((data || []) as DraymondAction[]).map((action) => {
    const { review_token: _t, review_token_expires_at: _e, ...publicAction } = action as DraymondAction & Record<string, unknown>;
    void _t;
    void _e;
    return publicAction as DraymondAction;
  });
}

// ============================================================================
// 3. TIERED MEMORY MANAGEMENT
// Solves: Amnesia on Update, Context Leakage, Flat Memory
// ============================================================================

/**
 * Default decay rates by memory tier
 */
const TIER_DEFAULTS: Record<MemoryTier, { importance: number; decay: number }> = {
  core: { importance: 1.0, decay: 0 },         // Never decays
  important: { importance: 0.8, decay: 0.005 }, // Very slow decay
  contextual: { importance: 0.5, decay: 0.02 }, // Moderate decay
  ephemeral: { importance: 0.3, decay: 0.1 },   // Fast decay
};

/**
 * Store a memory with automatic tiering and importance scoring.
 * Memories are ALWAYS bound to a specific user_id — preventing context leakage.
 */
export async function storeMemory(input: DraymondMemoryInsert): Promise<void> {
  const supabase = await createDraymondClient();

  const tier = input.tier || 'contextual';
  const defaults = TIER_DEFAULTS[tier];

  // Upsert: if a memory with the same key exists for this user+agent, update it
  const { error } = await supabase.from('draymond_memory').upsert(
    {
      agent_id: input.agent_id,
      user_id: input.user_id, // STRICT isolation
      key: input.key,
      value: input.value,
      summary: input.summary,
      tier,
      importance_score: input.importance_score ?? defaults.importance,
      decay_rate: input.decay_rate ?? defaults.decay,
      last_accessed_at: new Date().toISOString(),
      source_session_id: input.source_session_id,
      source_event: input.source_event,
      is_active: true,
      expired_at: null,
    },
    {
      onConflict: 'agent_id,user_id,key',
      ignoreDuplicates: false,
    }
  );

  if (error) throw new Error(`Failed to store memory: ${error.message}`);

  await logEvent({
    agent_id: input.agent_id,
    user_id: input.user_id,
    session_id: input.source_session_id,
    category: 'memory',
    severity: 'debug',
    event_type: 'memory_stored',
    message: `Stored memory "${input.key}" (tier: ${tier}, importance: ${input.importance_score ?? defaults.importance})`,
    metadata: { key: input.key, tier },
  });
}

/**
 * Retrieve memories for a specific user, ranked by tier and importance.
 * This function ALWAYS requires a user_id — context leakage is architecturally impossible.
 */
export async function retrieveMemories(
  agentId: string,
  userId: string,
  limit: number = 20
) {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_memory')
    .select('id, key, value, summary, tier, importance_score, last_accessed_at')
    .eq('agent_id', agentId)
    .eq('user_id', userId) // STRICT per-user isolation
    .eq('is_active', true)
    .order('importance_score', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to retrieve memories: ${error.message}`);

  // Bump access counts for retrieved memories
  if (data && data.length > 0) {
    const memoryIds = data.map((m: { id: string }) => m.id);
    const { error: accessError } = await supabase
      .from('draymond_memory')
      .update({ 
        last_accessed_at: new Date().toISOString(),
        // Note: ideally this would be atomic SQL, but Supabase JS doesn't support increment
      })
      .in('id', memoryIds);

    if (accessError) {
      console.error(`[Draymond] Failed to update memory access timestamps: ${accessError.message}`);
    }
  }

  return data || [];
}

/**
 * Boost a memory's importance (e.g. when the user references it again)
 */
export async function boostMemory(
  memoryId: string,
  boostAmount: number = 0.1
): Promise<void> {
  const supabase = await createDraymondClient();

  const { data: memory } = await supabase
    .from('draymond_memory')
    .select('importance_score')
    .eq('id', memoryId)
    .single();

  if (!memory) {
    console.warn(`[Draymond] boostMemory: memory ${memoryId} not found`);
    return;
  }

  const newImportance = Math.min(1.0, (memory as { importance_score: number }).importance_score + boostAmount);

  await supabase
    .from('draymond_memory')
    .update({
      importance_score: newImportance,
      last_accessed_at: new Date().toISOString(),
    })
    .eq('id', memoryId);
}

// ============================================================================
// 4. AUDIT TRAIL & EXPLAINABILITY
// Solves: Security & Governance Gaps, AB 316 Compliance
// ============================================================================

/**
 * Log an event to the audit trail.
 * Every decision, action, and state change is recorded.
 */
export async function logEvent(input: DraymondEventInsert): Promise<void> {
  const supabase = createDraymondAdminClient();

  const { error } = await supabase.from('draymond_events').insert({
    agent_id: input.agent_id,
    session_id: input.session_id,
    user_id: input.user_id,
    category: input.category,
    severity: input.severity,
    event_type: input.event_type,
    message: input.message,
    context_used: input.context_used || {},
    alternatives_considered: input.alternatives_considered || [],
    reasoning: input.reasoning,
    metadata: input.metadata || {},
  });

  if (error) {
    // Audit logging should never crash the main flow
    console.error('[Draymond] Failed to log event: %s', error.message, input);
  }
}

/**
 * Query audit events with filters
 */
export async function queryEvents(filters: {
  agent_id?: string;
  session_id?: string;
  category?: EventCategory;
  severity?: EventSeverity;
  event_type?: string;
  since?: string;
  limit?: number;
}) {
  const supabase = await createDraymondClient();

  const safeLimit = Math.min(Math.max(filters.limit || 50, 1), 200);

  let query = supabase
    .from('draymond_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (filters.agent_id) query = query.eq('agent_id', filters.agent_id);
  if (filters.session_id) query = query.eq('session_id', filters.session_id);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.severity) query = query.eq('severity', filters.severity);
  if (filters.event_type) query = query.eq('event_type', filters.event_type);
  if (filters.since) query = query.gte('created_at', filters.since);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to query events: ${error.message}`);
  return data || [];
}

// ============================================================================
// 5. MULTI-AGENT HANDOFF PROTOCOL
// Solves: Single-Point-of-Failure, No Coherent Workflow Layer
// ============================================================================

/**
 * Initiate a handoff from one agent to another, preserving state
 */
export async function initiateHandoff(input: DraymondHandoffInsert): Promise<string> {
  const supabase = await createDraymondClient();

  // If there's an active session, capture its state
  let stateSnapshot = input.state_snapshot || {};
  if (input.source_session_id) {
    const { data: session } = await supabase
      .from('draymond_sessions')
      .select('state_snapshot')
      .eq('id', input.source_session_id)
      .single();

    if (session) {
      stateSnapshot = { ...(session as { state_snapshot: Record<string, unknown> }).state_snapshot, ...stateSnapshot };
    }

    // End the source session
    await supabase
      .from('draymond_sessions')
      .update({ is_active: false, ended_at: new Date().toISOString() })
      .eq('id', input.source_session_id);
  }

  // Create the handoff record
  const { data: handoff, error } = await supabase
    .from('draymond_handoffs')
    .insert({
      source_agent_id: input.source_agent_id,
      source_session_id: input.source_session_id,
      target_agent_id: input.target_agent_id,
      reason: input.reason,
      status: 'initiated',
      state_snapshot: stateSnapshot,
      context_summary: input.context_summary,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to initiate handoff: ${error.message}`);

  // Log the handoff event
  await logEvent({
    agent_id: input.source_agent_id,
    session_id: input.source_session_id,
    category: 'handoff',
    severity: 'info',
    event_type: 'handoff_initiated',
    message: `Handoff to agent ${input.target_agent_id}: ${input.reason}`,
    context_used: { state_snapshot_keys: Object.keys(stateSnapshot) },
    reasoning: input.reason,
    metadata: { handoff_id: (handoff as { id: string }).id, target_agent_id: input.target_agent_id },
  });

  return (handoff as { id: string }).id;
}

/**
 * Accept a handoff and create a new session on the target agent
 */
export async function acceptHandoff(
  handoffId: string,
  triggerSource: string = 'handoff'
): Promise<{ sessionId: string }> {
  const supabase = await createDraymondClient();

  // Get the handoff
  const { data: handoff } = await supabase
    .from('draymond_handoffs')
    .select('*')
    .eq('id', handoffId)
    .eq('status', 'initiated')
    .single();

  if (!handoff) throw new Error(`Handoff ${handoffId} not found or already processed`);

  const typedHandoff = handoff as {
    target_agent_id: string;
    source_agent_id: string;
    state_snapshot: Record<string, unknown>;
  };

  // Create a new session on the target agent with the transferred state
  const { data: session, error: sessionError } = await supabase
    .from('draymond_sessions')
    .insert({
      agent_id: typedHandoff.target_agent_id,
      trigger_source: triggerSource,
      state_snapshot: typedHandoff.state_snapshot,
    })
    .select('id')
    .single();

  if (sessionError) throw new Error(`Failed to create target session: ${sessionError.message}`);

  const sessionId = (session as { id: string }).id;

  // Update the handoff
  const { error: handoffError } = await supabase
    .from('draymond_handoffs')
    .update({
      status: 'accepted',
      target_session_id: sessionId,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', handoffId);

  if (handoffError) {
    console.error(`[Draymond] Failed to update handoff status: ${handoffError.message}`);
  }

  await logEvent({
    agent_id: typedHandoff.target_agent_id,
    session_id: sessionId,
    category: 'handoff',
    severity: 'info',
    event_type: 'handoff_accepted',
    message: `Accepted handoff from agent ${typedHandoff.source_agent_id}`,
    metadata: { handoff_id: handoffId },
  });

  return { sessionId };
}

// ============================================================================
// 6. GOAL MANAGEMENT & ENFORCEMENT
// Solves: No Coherent Workflow Layer, Directionless Agents
// ============================================================================

/**
 * Create a goal for an agent (optionally scoped to a user/session)
 */
export async function createGoal(input: {
  agent_id: string;
  title: string;
  description?: string;
  horizon?: 'immediate' | 'short_term' | 'medium_term' | 'long_term';
  priority?: number;
  enforce_on_actions?: boolean;
  success_criteria?: Array<{ description: string; met: boolean }>;
  target_date?: string;
  user_id?: string;
  session_id?: string;
}): Promise<string> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_goals')
    .insert({
      agent_id: input.agent_id,
      user_id: input.user_id,
      session_id: input.session_id,
      title: input.title,
      description: input.description,
      horizon: input.horizon || 'short_term',
      priority: input.priority || 50,
      enforce_on_actions: input.enforce_on_actions || false,
      success_criteria: input.success_criteria || [],
      target_date: input.target_date,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create goal: ${error.message}`);

  await logEvent({
    agent_id: input.agent_id,
    user_id: input.user_id,
    session_id: input.session_id,
    category: 'goal',
    severity: 'info',
    event_type: 'goal_created',
    message: `Goal created: "${input.title}" (${input.horizon || 'short_term'})`,
    metadata: { goal_id: (data as { id: string }).id },
  });

  return (data as { id: string }).id;
}

/**
 * Find a goal for an agent by title. Used by the finance-connect sync to
 * upsert instead of creating duplicates. Returns the most recent match.
 */
export async function findGoal(input: {
  agent_id: string;
  title: string;
}): Promise<{ id: string } | null> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_goals')
    .select('id')
    .eq('agent_id', input.agent_id)
    .eq('title', input.title)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to find goal: ${error.message}`);
  return (data as { id: string } | null) ?? null;
}

/**
 * Update goal progress
 */
export async function updateGoalProgress(
  goalId: string,
  progressPct: number,
  updatedCriteria?: Array<{ description: string; met: boolean }>
): Promise<void> {
  const supabase = await createDraymondClient();

  const updateData: Record<string, unknown> = {
    progress_pct: Math.min(100, Math.max(0, progressPct)),
  };

  if (updatedCriteria) {
    updateData.success_criteria = updatedCriteria;
  }

  if (progressPct >= 100) {
    updateData.status = 'completed';
    updateData.completed_at = new Date().toISOString();
  }

  const { error: goalError } = await supabase.from('draymond_goals').update(updateData).eq('id', goalId);

  if (goalError) {
    console.error(`[Draymond] Failed to update goal progress: ${goalError.message}`);
  }
}

// ============================================================================
// 7. SESSION MANAGEMENT
// ============================================================================

/**
 * Create a new supervised agent session
 */
export async function createSession(input: {
  agent_id: string;
  user_id?: string;
  trigger_source?: string;
  parent_session_id?: string;
}): Promise<string> {
  const supabase = await createDraymondClient();

  const { data, error } = await supabase
    .from('draymond_sessions')
    .insert({
      agent_id: input.agent_id,
      user_id: input.user_id,
      trigger_source: input.trigger_source || 'manual',
      parent_session_id: input.parent_session_id,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * End a session and capture final metrics
 */
export async function endSession(sessionId: string): Promise<void> {
  const supabase = await createDraymondClient();

  const { error: sessionError } = await supabase
    .from('draymond_sessions')
    .update({
      is_active: false,
      ended_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  if (sessionError) {
    console.error(`[Draymond] Failed to end session: ${sessionError.message}`);
  }
}

// ============================================================================
// 8. AGENT HEALTH CHECKS (for Scheduler / Cron)
// ============================================================================

/**
 * Run health checks on all registered agents and trigger recovery for any
 * that are stalled or crashed. Returns the full set of health reports.
 *
 * Used by the autonomous scheduler (`scheduler.ts`) and the cron API route.
 */
export async function checkAllAgentHealth(): Promise<{
  reports: AgentHealthReport[];
  recovered: string[];
  failedOver: string[];
}> {
  const reports = await getAgentHealthReports();
  const recovered: string[] = [];
  const failedOver: string[] = [];

  for (const report of reports) {
    if (report.recommendation === 'recover' || report.recommendation === 'failover') {
      try {
        const result = await initiateRecovery(report.agent_id);
        if (result.recovered) {
          recovered.push(report.agent_name);
        } else if (result.failoverAgentId) {
          failedOver.push(report.agent_name);
        }
      } catch (err) {
        console.error(
          '[Draymond] checkAllAgentHealth: recovery failed for "%s":',
          report.agent_name,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  return { reports, recovered, failedOver };
}

// ============================================================================
// 9. DASHBOARD SUMMARY
// ============================================================================

/**
 * Get a full dashboard summary for the Draymond admin panel
 */
export async function getDashboardSummary(): Promise<DraymondDashboardSummary> {
  const supabase = await createDraymondClient();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Parallel queries for performance
  const [agentsResult, pendingResult, actionsResult, eventsResult, handoffsResult, topEventsResult] =
    await Promise.all([
      supabase.from('draymond_agents').select('status'),
      supabase.from('draymond_actions').select('*', { count: 'exact', head: true }).eq('status', 'pending_review'),
      supabase
        .from('draymond_actions')
        .select('confidence_score')
        .gte('created_at', twentyFourHoursAgo),
      supabase
        .from('draymond_events')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', twentyFourHoursAgo),
      supabase
        .from('draymond_handoffs')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', twentyFourHoursAgo),
      supabase
        .from('draymond_events')
        .select('*')
        .in('severity', ['warning', 'error', 'critical'])
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

  const agents = (agentsResult.data || []) as Array<{ status: string }>;
  const actions24h = (actionsResult.data || []) as Array<{ confidence_score: number }>;

  const avgConfidence =
    actions24h.length > 0
      ? actions24h.reduce((sum, a) => sum + a.confidence_score, 0) / actions24h.length
      : null;

  return {
    total_agents: agents.length,
    healthy_agents: agents.filter((a) => a.status === 'active').length,
    degraded_agents: agents.filter((a) => a.status === 'degraded').length,
    stalled_agents: agents.filter((a) => a.status === 'stalled' || a.status === 'crashed').length,
    pending_actions: pendingResult.count ?? 0,
    actions_last_24h: actions24h.length,
    events_last_24h: eventsResult.count ?? 0,
    handoffs_last_24h: handoffsResult.count ?? 0,
    avg_confidence_last_24h: avgConfidence,
    top_events: (topEventsResult.data || []) as DraymondDashboardSummary['top_events'],
  };
}
