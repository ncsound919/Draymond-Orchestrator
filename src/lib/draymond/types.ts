// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — TypeScript Types
// The Intelligent Agent Supervision Layer
// ============================================================================

// --- Enum Types ---

export type AgentStatus =
  | 'active'
  | 'degraded'
  | 'stalled'
  | 'crashed'
  | 'recovering'
  | 'suspended'
  | 'terminated';

export type AgentCapability =
  | 'chat'
  | 'search'
  | 'analysis'
  | 'generation'
  | 'automation'
  | 'moderation'
  | 'embedding'
  | 'orchestration';

export type EventSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export type EventCategory =
  | 'health'
  | 'action'
  | 'decision'
  | 'hallucination'
  | 'recovery'
  | 'handoff'
  | 'memory'
  | 'confidence'
  | 'security'
  | 'goal'
  | 'human_review';

export type ActionStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'auto_executed'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'expired';

export type ActionRiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export type MemoryTier = 'core' | 'important' | 'contextual' | 'ephemeral';

export type HandoffStatus =
  | 'initiated'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export type GoalStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export type GoalHorizon = 'immediate' | 'short_term' | 'medium_term' | 'long_term';

// --- Row Types ---

export type DraymondAgent = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  version: string;
  capabilities: AgentCapability[];
  model_provider: string | null;
  model_id: string | null;
  fallback_model_provider: string | null;
  fallback_model_id: string | null;
  config: Record<string, unknown>;
  status: AgentStatus;
  last_heartbeat: string | null;
  heartbeat_interval_seconds: number;
  max_consecutive_errors: number;
  consecutive_errors: number;
  confidence_threshold_auto: number;
  confidence_threshold_review: number;
  max_retries: number;
  retry_backoff_ms: number;
  auto_recovery_enabled: boolean;
  fallback_agent_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DraymondSession = {
  id: string;
  agent_id: string;
  user_id: string | null;
  started_at: string;
  ended_at: string | null;
  is_active: boolean;
  trigger_source: string | null;
  parent_session_id: string | null;
  total_actions: number;
  successful_actions: number;
  failed_actions: number;
  human_reviews_requested: number;
  avg_confidence: number | null;
  state_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DraymondGoal = {
  id: string;
  agent_id: string;
  user_id: string | null;
  session_id: string | null;
  title: string;
  description: string | null;
  horizon: GoalHorizon;
  status: GoalStatus;
  progress_pct: number;
  success_criteria: SuccessCriterion[];
  priority: number;
  enforce_on_actions: boolean;
  target_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SuccessCriterion = {
  description: string;
  met: boolean;
  measured_value?: number | string;
  target_value?: number | string;
};

export type DraymondEvent = {
  id: string;
  agent_id: string;
  session_id: string | null;
  user_id: string | null;
  category: EventCategory;
  severity: EventSeverity;
  event_type: string;
  message: string;
  context_used: Record<string, unknown>;
  alternatives_considered: AlternativeConsidered[];
  reasoning: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AlternativeConsidered = {
  option: string;
  reason_rejected: string;
  confidence?: number;
};

export type DraymondMemory = {
  id: string;
  agent_id: string;
  user_id: string;
  key: string;
  value: Record<string, unknown>;
  summary: string | null;
  tier: MemoryTier;
  importance_score: number;
  decay_rate: number;
  last_accessed_at: string;
  access_count: number;
  source_session_id: string | null;
  source_event: string | null;
  is_active: boolean;
  expired_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DraymondAction = {
  id: string;
  agent_id: string;
  session_id: string | null;
  user_id: string | null;
  action_type: string;
  description: string;
  payload: Record<string, unknown>;
  confidence_score: number;
  risk_level: ActionRiskLevel;
  confidence_reasoning: string | null;
  status: ActionStatus;
  requires_human_review: boolean;
  review_token: string | null;
  review_token_expires_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  executed_at: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  goal_id: string | null;
  goal_alignment_score: number | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DraymondHandoff = {
  id: string;
  source_agent_id: string;
  source_session_id: string | null;
  target_agent_id: string;
  target_session_id: string | null;
  reason: string;
  status: HandoffStatus;
  state_snapshot: Record<string, unknown>;
  context_summary: string | null;
  initiated_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
};

// --- Insert Types ---

export type DraymondAgentInsert = {
  name: string;
  slug: string;
  description?: string;
  version?: string;
  capabilities?: AgentCapability[];
  model_provider?: string;
  model_id?: string;
  fallback_model_provider?: string;
  fallback_model_id?: string;
  config?: Record<string, unknown>;
  status?: AgentStatus;
  heartbeat_interval_seconds?: number;
  max_consecutive_errors?: number;
  confidence_threshold_auto?: number;
  confidence_threshold_review?: number;
  max_retries?: number;
  retry_backoff_ms?: number;
  auto_recovery_enabled?: boolean;
  fallback_agent_id?: string;
};

export type DraymondEventInsert = {
  agent_id: string;
  session_id?: string;
  user_id?: string;
  category: EventCategory;
  severity: EventSeverity;
  event_type: string;
  message: string;
  context_used?: Record<string, unknown>;
  alternatives_considered?: AlternativeConsidered[];
  reasoning?: string;
  metadata?: Record<string, unknown>;
};

export type DraymondMemoryInsert = {
  agent_id: string;
  user_id: string;
  key: string;
  value: Record<string, unknown>;
  summary?: string;
  tier?: MemoryTier;
  importance_score?: number;
  decay_rate?: number;
  source_session_id?: string;
  source_event?: string;
};

export type DraymondActionInsert = {
  agent_id: string;
  session_id?: string;
  user_id?: string;
  action_type: string;
  description: string;
  payload?: Record<string, unknown>;
  confidence_score: number;
  risk_level?: ActionRiskLevel;
  confidence_reasoning?: string;
  goal_id?: string;
  goal_alignment_score?: number;
  expires_at?: string;
};

export type DraymondHandoffInsert = {
  source_agent_id: string;
  source_session_id?: string;
  target_agent_id: string;
  reason: string;
  state_snapshot?: Record<string, unknown>;
  context_summary?: string;
};

// --- Confidence Gate Decision ---

export type ConfidenceDecision = {
  action: 'auto_execute' | 'queue_for_review' | 'block';
  confidence_score: number;
  threshold_auto: number;
  threshold_review: number;
  risk_level: ActionRiskLevel;
  reasoning: string;
};

// --- Agent Health Report ---

export type AgentHealthReport = {
  agent_id: string;
  agent_name: string;
  status: AgentStatus;
  last_heartbeat: string | null;
  seconds_since_heartbeat: number | null;
  consecutive_errors: number;
  is_healthy: boolean;
  active_sessions: number;
  recommendation: 'none' | 'monitor' | 'investigate' | 'recover' | 'failover';
};

// --- Dashboard Summary ---

export type DraymondDashboardSummary = {
  total_agents: number;
  healthy_agents: number;
  degraded_agents: number;
  stalled_agents: number;
  pending_actions: number;
  actions_last_24h: number;
  events_last_24h: number;
  handoffs_last_24h: number;
  avg_confidence_last_24h: number | null;
  top_events: DraymondEvent[];
};

// ============================================================================
// UNIFIED ENTITY REGISTRY — Types
// Every agent, tool, skill, extension, MCP server, and service
// ============================================================================

export type EntityKind =
  | 'agent'
  | 'tool'
  | 'skill'
  | 'extension'
  | 'mcp_server'
  | 'service'
  | 'pipeline';

export type InvocationMethod =
  | 'api_call'
  | 'http_api'
  | 'cli_command'
  | 'subprocess'
  | 'python_module'
  | 'node_module'
  | 'mcp_tool'
  | 'mcp_stdio'
  | 'internal'
  | 'manual'
  | 'webhook'
  | 'message_gateway'
  | 'pipeline';

export type ChainStatus =
  | 'draft'
  | 'active'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived';

export type StepStatus =
  | 'pending'
  | 'waiting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'blocked'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'retrying';

// --- Entity Registry Row ---

export type DraymondEntity = {
  id: string;
  name: string;
  slug: string;
  kind: EntityKind;
  description: string | null;
  version: string;
  icon_url: string | null;
  tags: string[];
  category: string | null;
  sector: string | null;
  invocation_method: InvocationMethod;
  invocation_config: Record<string, unknown>;
  capabilities: string[];
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  depends_on: string[];
  source_type: string | null;
  source_url: string | null;
  download_path: string | null;
  is_free: boolean;
  price_cents: number | null;
  stripe_link: string | null;
  is_integrated: boolean;
  platform_page: string | null;
  linked_agent_id: string | null;
  confidence_threshold_override: number | null;
  risk_level_default: string;
  max_retries: number;
  timeout_seconds: number;
  is_active: boolean;
  health_status: string;
  last_invoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DraymondEntityInsert = {
  name: string;
  slug: string;
  kind: EntityKind;
  description?: string;
  version?: string;
  icon_url?: string;
  tags?: string[];
  category?: string;
  sector?: string;
  invocation_method?: InvocationMethod;
  invocation_config?: Record<string, unknown>;
  capabilities?: string[];
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  depends_on?: string[];
  source_type?: string;
  source_url?: string;
  download_path?: string;
  is_free?: boolean;
  price_cents?: number;
  stripe_link?: string;
  is_integrated?: boolean;
  platform_page?: string;
  linked_agent_id?: string;
  confidence_threshold_override?: number;
  risk_level_default?: string;
  max_retries?: number;
  timeout_seconds?: number;
  is_active?: boolean;
  health_status?: string;
};

// --- Chain Row ---

export type DraymondChain = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  version: string;
  is_template: boolean;
  template_id: string | null;
  created_by: string | null;
  agent_id: string | null;
  status: ChainStatus;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
  context: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  total_steps: number;
  completed_steps: number;
  failed_steps: number;
  total_duration_ms: number | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  session_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DraymondChainResult = {
  success: boolean;
  error?: string;
  output?: unknown;
  input_data?: Record<string, unknown>;
};

export type DraymondChainInsert = {
  name: string;
  slug: string;
  description?: string;
  version?: string;
  is_template?: boolean;
  template_id?: string;
  created_by?: string;
  agent_id?: string;
  status?: ChainStatus;
  trigger_type?: string;
  trigger_config?: Record<string, unknown>;
  input_data?: Record<string, unknown>;
  context?: Record<string, unknown>;
  max_retries?: number;
  session_id?: string;
};

// --- Chain Step Row ---

export type DraymondChainStep = {
  id: string;
  chain_id: string;
  step_order: number;
  name: string;
  description: string | null;
  entity_id: string;
  action: string;
  input_mapping: Record<string, unknown>;
  output_key: string | null;
  condition: Record<string, unknown> | null;
  depends_on_steps: string[];
  parallel_group: string | null;
  confidence_threshold: number | null;
  risk_level: string;
  status: StepStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  input_data: Record<string, unknown>;
  output_data: Record<string, unknown>;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  action_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DraymondChainStepInsert = {
  chain_id: string;
  step_order: number;
  name: string;
  description?: string;
  entity_id: string;
  action: string;
  input_mapping?: Record<string, unknown>;
  output_key?: string;
  condition?: Record<string, unknown>;
  depends_on_steps?: string[];
  parallel_group?: string;
  confidence_threshold?: number;
  risk_level?: string;
  max_retries?: number;
};

// --- Entity Relation Row ---

export type DraymondEntityRelation = {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type DraymondEntityRelationInsert = {
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  metadata?: Record<string, unknown>;
};

// --- Chain Execution Plan (returned by SQL function) ---

export type ChainExecutionPlanStep = {
  step_id: string;
  step_order: number;
  step_name: string;
  entity_id: string;
  entity_name: string;
  entity_kind: EntityKind;
  parallel_group: string | null;
  depends_on_steps: string[];
  status: StepStatus;
};

// --- Registry Search Filters ---

export type EntitySearchFilters = {
  kind?: EntityKind;
  category?: string;
  sector?: string;
  capability?: string;
  tag?: string;
  is_integrated?: boolean;
  is_active?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
};

// --- Chain Execution Context ---

export type ChainExecutionContext = {
  chain_id: string;
  input: Record<string, unknown>;
  context: Record<string, unknown>;
  steps: Record<string, {
    status: StepStatus;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    error?: string;
    duration_ms?: number;
  }>;
};

// ============================================================================
// INTELLIGENT TASK ROUTER — Types
// LLM-powered intent classification and entity resolution from natural language
// ============================================================================

export type RouterIntent =
  | 'invoke_entity'
  | 'execute_chain'
  | 'query_status'
  | 'manage_memory'
  | 'decompose_goal'
  | 'web_search'
  | 'casual_chat'
  | 'unknown';

export type RouteResult = {
  intent: RouterIntent;
  confidence: number;
  entity_slug?: string;
  chain_slug?: string;
  action?: string;
  input?: Record<string, unknown>;
  reasoning: string;
  alternatives: Array<{
    intent: RouterIntent;
    entity_slug?: string;
    chain_slug?: string;
    confidence: number;
  }>;
  resolved_at: string;
  latency_ms: number;
};

export type RouterConfig = {
  /** Model to use for intent classification */
  model: string;
  /** Provider for the model */
  provider: 'opencode-free' | 'opencode' | 'deepseek' | 'gemini' | 'openai' | 'anthropic' | 'qwen';
  /** Temperature for LLM calls (lower = more deterministic) */
  temperature: number;
  /** Minimum confidence to auto-route without confirmation */
  auto_route_threshold: number;
  /** Below this confidence, fall back to asking the user */
  fallback_threshold: number;
  /** Maximum tokens for classification response */
  max_tokens: number;
  /** Timeout in ms */
  timeout_ms: number;
  /** Try the cheap local Ollama model first (opt-in; needs a capable model). */
  use_local_model?: boolean;
  /** Ask the deterministic brain's /reason BEFORE the paid LLM and skip the
   *  LLM when the brain classifies with confidence >= brain_pre_route_confidence.
   *  Only active when BRAIN_URL is configured. Default true. */
  use_brain_pre_route?: boolean;
  /** Confidence the brain /reason must reach to skip the paid LLM call. */
  brain_pre_route_confidence?: number;
};

// ============================================================================
// ADAPTIVE CONFIDENCE SCORING — Types
// Real scores from execution results, historical success rates, self-tuning
// ============================================================================

export type ConfidenceSignal = {
  source: 'execution_result' | 'historical_rate' | 'entity_health' | 'chain_context' | 'llm_assessment' | 'recent_trend';
  weight: number;
  score: number;
  reasoning: string;
};

export type AdaptiveConfidenceResult = {
  final_score: number;
  signals: ConfidenceSignal[];
  entity_id: string;
  entity_slug: string;
  historical_success_rate: number | null;
  recent_executions: number;
  threshold_recommendation: number;
  computed_at: string;
};

export type EntityPerformanceRecord = {
  entity_id: string;
  entity_slug: string;
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  p99_duration_ms: number;
  success_rate: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  current_streak: number;
  streak_type: 'success' | 'failure';
  computed_at: string;
};

// ============================================================================
// REACTIVE EVENT SYSTEM — Types
// Event subscriptions, cross-chain triggers, conditional chain spawning
// ============================================================================

export type EventPattern = {
  event_type: string;
  /** JSONPath-like conditions on the event data */
  conditions?: Record<string, unknown>;
  /** Debounce window in ms — prevents rapid re-triggering */
  debounce_ms?: number;
};

export type EventSubscription = {
  id: string;
  name: string;
  description: string | null;
  pattern: EventPattern;
  action_type: 'invoke_entity' | 'execute_chain' | 'emit_event' | 'webhook';
  action_config: {
    entity_slug?: string;
    chain_slug?: string;
    event_type?: string;
    webhook_url?: string;
    input_mapping?: Record<string, string>;
  };
  is_active: boolean;
  last_triggered_at: string | null;
  trigger_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EventSubscriptionInsert = {
  name: string;
  description?: string;
  pattern: EventPattern;
  action_type: EventSubscription['action_type'];
  action_config: EventSubscription['action_config'];
  is_active?: boolean;
  created_by?: string;
};

export type ReactiveEvent = {
  id: string;
  event_type: string;
  source: string;
  data: Record<string, unknown>;
  matched_subscriptions: string[];
  processed_at: string | null;
  created_at: string;
};

// ============================================================================
// MEMORY INTELLIGENCE — Types
// Semantic search, auto-decay, cross-agent sharing, memory-informed decisions
// ============================================================================

export type MemorySearchResult = {
  memory: DraymondMemory;
  relevance_score: number;
  match_type: 'exact_key' | 'semantic' | 'tag' | 'summary';
};

export type MemorySharePermission = 'read' | 'read_write' | 'full';

export type MemoryShareGrant = {
  id: string;
  memory_id: string;
  owner_agent_id: string;
  granted_agent_id: string;
  permission: MemorySharePermission;
  granted_at: string;
  expires_at: string | null;
  is_active: boolean;
};

export type MemoryShareGrantInsert = {
  memory_id: string;
  owner_agent_id: string;
  granted_agent_id: string;
  permission: MemorySharePermission;
  expires_at?: string;
};

export type MemoryDecayResult = {
  total_scanned: number;
  decayed: number;
  expired: number;
  boosted: number;
  sweep_duration_ms: number;
  swept_at: string;
};

export type MemoryInsight = {
  agent_id: string;
  total_memories: number;
  active_memories: number;
  expired_memories: number;
  by_tier: Record<MemoryTier, number>;
  avg_importance: number;
  oldest_memory_at: string | null;
  newest_memory_at: string | null;
  most_accessed_keys: Array<{ key: string; access_count: number }>;
};

// ============================================================================
// OBSERVABILITY & ANALYTICS — Types
// Performance leaderboard, execution heatmaps, cost tracking, latency percentiles
// ============================================================================

export type EntityLeaderboardEntry = {
  entity_id: string;
  entity_slug: string;
  entity_name: string;
  entity_kind: EntityKind;
  total_executions: number;
  success_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  total_cost_cents: number;
  score: number;
  rank: number;
};

export type ExecutionHeatmapPoint = {
  hour: number;       // 0-23
  day_of_week: number; // 0-6 (Sun-Sat)
  execution_count: number;
  avg_duration_ms: number;
  failure_rate: number;
};

export type CostRecord = {
  id: string;
  entity_id: string;
  chain_id: string | null;
  step_id: string | null;
  cost_type: 'llm_tokens' | 'api_call' | 'compute' | 'storage' | 'external';
  amount_cents: number;
  unit_count: number;
  unit_label: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type CostRecordInsert = {
  entity_id: string;
  chain_id?: string;
  step_id?: string;
  cost_type: CostRecord['cost_type'];
  amount_cents: number;
  unit_count?: number;
  unit_label?: string;
  metadata?: Record<string, unknown>;
};

export type AnalyticsSummary = {
  period: 'hour' | 'day' | 'week' | 'month';
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  total_chains_run: number;
  total_cost_cents: number;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  busiest_hour: number;
  top_entities: EntityLeaderboardEntry[];
  heatmap: ExecutionHeatmapPoint[];
  computed_at: string;
};

export type ExecutionLog = {
  id: string;
  entity_id: string;
  entity_slug: string;
  chain_id: string | null;
  step_id: string | null;
  action: string;
  success: boolean;
  duration_ms: number;
  input_summary: string;
  output_summary: string;
  error_message: string | null;
  cost_cents: number;
  created_at: string;
};

export type ExecutionLogInsert = {
  entity_id: string;
  entity_slug: string;
  chain_id?: string;
  step_id?: string;
  action: string;
  success: boolean;
  duration_ms: number;
  input_summary?: string;
  output_summary?: string;
  error_message?: string;
  cost_cents?: number;
};

// ============================================================================
// DYNAMIC CHAIN BUILDER — Types
// Natural language to entity chain conversion
// ============================================================================

export type ChainBlueprintStep = {
  name: string;
  description: string;
  entity_slug: string;
  action: string;
  input_mapping: Record<string, string>;
  output_key: string;
  depends_on: string[];
  parallel_group?: string;
  confidence_threshold?: number;
  risk_level?: string;
};

export type ChainBlueprint = {
  name: string;
  slug: string;
  description: string;
  steps: ChainBlueprintStep[];
  estimated_duration_ms: number;
  estimated_cost_cents: number;
  confidence: number;
  reasoning: string;
  warnings: string[];
  generated_at: string;
};

export type ChainBuildRequest = {
  description: string;
  constraints?: {
    max_steps?: number;
    max_duration_ms?: number;
    max_cost_cents?: number;
    required_entities?: string[];
    excluded_entities?: string[];
    parallel_allowed?: boolean;
  };
  context?: Record<string, unknown>;
};

export type ChainBuildResult = {
  blueprint: ChainBlueprint;
  chain_id?: string;
  auto_created: boolean;
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    missing_entities: string[];
  };
};

// ============================================================================
// BENCHMARKING
// ============================================================================

export type ComponentClass = 'entity' | 'site' | 'cron' | 'chain';

export interface BenchmarkMetric {
  component_class: ComponentClass;
  component_slug: string;
  component_name: string;
  /** Free-form metric bag: fail_count, latency_ms, uptime_pct, errors, etc. */
  metrics: Record<string, unknown>;
  /** Raw evidence string for auditability (never fabricated). */
  evidence: string;
}

export interface WeaknessScore {
  component_class: ComponentClass;
  component_slug: string;
  component_name: string;
  /** 0 = healthy, 100 = worst. */
  score: number;
  reasons: string[];
  trend: 'improving' | 'flat' | 'worsening';
}

export interface DeepScoreResult {
  scorer: string;
  score: number | null;
  summary: string;
  detail?: string;
  error?: string;
}

export interface UpgradeQueueItem {
  id: string;
  component_class: ComponentClass;
  component_slug: string;
  component_name: string;
  weakness_score: number;
  reasons: string[];
  proposed_action: string;
  deep_scores: Record<string, DeepScoreResult>;
  status: 'queued' | 'in_progress' | 'completed' | 'dismissed';
  created_at: string;
  completed_at: string | null;
}
