// ============================================================================
// Local SQLite schema for Draymond Orchestrator
// Ported from supabase/migrations/*.sql (004-013). Supabase-specific features
// (Row Level Security, auth.users FKs, triggers, gen_random_uuid) are replaced
// by equivalent SQLite constructs. JSONB columns are stored as TEXT (JSON),
// booleans as INTEGER (0/1), timestamps as ISO-8601 UTC strings, and uuids as
// TEXT. FK constraints are intentionally omitted — the app treats ids as
// opaque strings and the import path is simpler without them.
// ============================================================================

export interface ColumnMap {
  /** Columns that hold JSON values (jsonb or text[] in Postgres). */
  json: string[];
  /** Columns that hold booleans in Postgres (stored as 0/1 in SQLite). */
  bool: string[];
}

export const COLUMN_MAPS: Record<string, ColumnMap> = {
  draymond_conversations: {
    json: [],
    bool: [],
  },
  draymond_agents: {
    json: ['capabilities', 'config'],
    bool: ['auto_recovery_enabled'],
  },
  draymond_sessions: {
    json: ['state_snapshot'],
    bool: ['is_active'],
  },
  draymond_events: {
    json: ['context_used', 'alternatives_considered', 'metadata'],
    bool: [],
  },
  draymond_actions: {
    json: ['payload', 'result'],
    bool: ['requires_human_review'],
  },
  draymond_memory: {
    json: ['value'],
    bool: ['is_active'],
  },
  draymond_handoffs: {
    json: ['state_snapshot'],
    bool: [],
  },
  draymond_entities: {
    json: ['tags', 'invocation_config', 'capabilities', 'input_schema', 'output_schema', 'depends_on'],
    bool: ['is_free', 'is_integrated', 'is_active'],
  },
  draymond_chains: {
    json: ['trigger_config', 'input_data', 'output_data', 'context'],
    bool: ['is_template'],
  },
  draymond_chain_steps: {
    json: ['input_mapping', 'condition', 'depends_on_steps', 'input_data', 'output_data'],
    bool: [],
  },
  draymond_entity_relations: {
    json: ['metadata'],
    bool: [],
  },
  draymond_goals: {
    json: ['success_criteria'],
    bool: ['enforce_on_actions'],
  },
  draymond_notifications: {
    json: ['metadata'],
    bool: [],
  },
  draymond_scheduled_jobs: {
    json: ['job_config'],
    bool: ['is_enabled', 'notify_on_failure', 'notify_on_success'],
  },
  draymond_site_monitors: {
    json: ['metadata'],
    bool: ['is_enabled', 'notify_on_down', 'notify_on_recovery'],
  },
  draymond_messages: {
    json: ['metadata'],
    bool: [],
  },
  draymond_execution_logs: {
    json: [],
    bool: ['success'],
  },
  draymond_cost_records: {
    json: ['metadata'],
    bool: [],
  },
  draymond_event_subscriptions: {
    json: ['pattern', 'action_config'],
    bool: ['is_active'],
  },
  draymond_reactive_events: {
    json: ['data', 'matched_subscriptions'],
    bool: [],
  },
  draymond_memory_shares: {
    json: [],
    bool: ['is_active'],
  },
  brain_wiki_pages: {
    json: ['tags', 'sources', 'aliases'],
    bool: [],
  },
  draymond_benchmarks: {
    json: ['metrics', 'trend', 'deep_scores'],
    bool: [],
  },
  draymond_upgrade_queue: {
    json: ['reasons', 'deep_scores'],
    bool: [],
  },
  local_users: {
    json: [],
    bool: [],
  },
  local_sessions: {
    json: [],
    bool: [],
  },
  purchases: {
    json: [],
    bool: [],
  },
  draymond_skill_packs: {
    json: ['triggers', 'tools', 'platforms', 'outputs'],
    bool: [],
  },
  draymond_worker_tasks: {
    json: ['payload', 'result', 'artifact_refs'],
    bool: [],
  },
  draymond_worker_proposals: {
    json: ['pack'],
    bool: [],
  },
  science_insights: {
    json: ['report'],
    bool: [],
  },
  science_gaps: {
    json: ['payload'],
    bool: [],
  },
  command_leads: {
    json: ['tags', 'notes', 'metadata'],
    bool: [],
  },
  command_seo_tasks: {
    json: ['metadata'],
    bool: ['is_done'],
  },
  tid_signals: {
    json: ['context'],
    bool: [],
  },
  tid_insights: {
    json: ['evidence', 'suggested_action'],
    bool: [],
  },
  tid_discoveries: {
    json: ['action_detail', 'outcome'],
    bool: [],
  },
};

/** Names of the draymond tables that carry an auto-managed `id` (uuid) column. */
const TABLES_WITH_ID = new Set([
  'draymond_conversations',
  'draymond_agents',
  'draymond_sessions',
  'draymond_events',
  'draymond_actions',
  'draymond_memory',
  'draymond_handoffs',
  'draymond_entities',
  'draymond_chains',
  'draymond_chain_steps',
  'draymond_entity_relations',
  'draymond_goals',
  'draymond_notifications',
  'draymond_scheduled_jobs',
  'draymond_site_monitors',
  'draymond_messages',
  'draymond_execution_logs',
  'draymond_cost_records',
  'draymond_event_subscriptions',
  'draymond_reactive_events',
  'draymond_memory_shares',
  'brain_wiki_pages',
  'draymond_benchmarks',
  'draymond_upgrade_queue',
  'purchases',
  'command_leads',
  'command_seo_tasks',
]);

export function tableHasIdColumn(table: string): boolean {
  return TABLES_WITH_ID.has(table);
}

// ============================================================================
// DDL
// ============================================================================

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS draymond_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_conversations_user ON draymond_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS draymond_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  capabilities TEXT NOT NULL DEFAULT '[]',
  model_provider TEXT,
  model_id TEXT,
  fallback_model_provider TEXT,
  fallback_model_id TEXT,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  last_heartbeat TEXT,
  heartbeat_interval_seconds INTEGER NOT NULL DEFAULT 60,
  max_consecutive_errors INTEGER NOT NULL DEFAULT 5,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  confidence_threshold_auto REAL NOT NULL DEFAULT 0.85,
  confidence_threshold_review REAL NOT NULL DEFAULT 0.6,
  max_retries INTEGER NOT NULL DEFAULT 3,
  retry_backoff_ms INTEGER NOT NULL DEFAULT 1000,
  auto_recovery_enabled INTEGER NOT NULL DEFAULT 1,
  fallback_agent_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_agents_slug ON draymond_agents(slug);
CREATE INDEX IF NOT EXISTS idx_draymond_agents_status ON draymond_agents(status);

CREATE TABLE IF NOT EXISTS draymond_sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  user_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  trigger_source TEXT,
  parent_session_id TEXT,
  total_actions INTEGER NOT NULL DEFAULT 0,
  successful_actions INTEGER NOT NULL DEFAULT 0,
  failed_actions INTEGER NOT NULL DEFAULT 0,
  human_reviews_requested INTEGER NOT NULL DEFAULT 0,
  avg_confidence REAL,
  state_snapshot TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_sessions_agent ON draymond_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_sessions_active ON draymond_sessions(is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS draymond_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  user_id TEXT,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  context_used TEXT NOT NULL DEFAULT '{}',
  alternatives_considered TEXT NOT NULL DEFAULT '[]',
  reasoning TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_events_agent ON draymond_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_events_session ON draymond_events(session_id);
CREATE INDEX IF NOT EXISTS idx_draymond_events_category ON draymond_events(category);
CREATE INDEX IF NOT EXISTS idx_draymond_events_severity ON draymond_events(severity);
CREATE INDEX IF NOT EXISTS idx_draymond_events_created ON draymond_events(created_at DESC);

CREATE TABLE IF NOT EXISTS draymond_actions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  user_id TEXT,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  confidence_score REAL NOT NULL DEFAULT 0.5,
  risk_level TEXT NOT NULL DEFAULT 'low',
  confidence_reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  requires_human_review INTEGER NOT NULL DEFAULT 0,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_notes TEXT,
  executed_at TEXT,
  result TEXT,
  error_message TEXT,
  goal_id TEXT,
  goal_alignment_score REAL,
  expires_at TEXT,
  review_token TEXT,
  review_token_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_actions_agent ON draymond_actions(agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_actions_status ON draymond_actions(status);
CREATE INDEX IF NOT EXISTS idx_draymond_actions_review ON draymond_actions(requires_human_review) WHERE requires_human_review = 1;
CREATE INDEX IF NOT EXISTS idx_draymond_actions_review_token ON draymond_actions(review_token) WHERE review_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS draymond_memory (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  tier TEXT NOT NULL DEFAULT 'contextual',
  importance_score REAL NOT NULL DEFAULT 0.5,
  decay_rate REAL NOT NULL DEFAULT 0.01,
  last_accessed_at TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  source_session_id TEXT,
  source_event TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  expired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (agent_id, user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_draymond_memory_agent_user ON draymond_memory(agent_id, user_id);
CREATE INDEX IF NOT EXISTS idx_draymond_memory_key ON draymond_memory(key);
CREATE INDEX IF NOT EXISTS idx_draymond_memory_tier ON draymond_memory(tier);
CREATE INDEX IF NOT EXISTS idx_draymond_memory_active ON draymond_memory(is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS draymond_handoffs (
  id TEXT PRIMARY KEY,
  source_agent_id TEXT NOT NULL,
  source_session_id TEXT,
  target_agent_id TEXT NOT NULL,
  target_session_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated',
  state_snapshot TEXT NOT NULL DEFAULT '{}',
  context_summary TEXT,
  initiated_at TEXT NOT NULL,
  accepted_at TEXT,
  completed_at TEXT,
  failure_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_handoffs_source ON draymond_handoffs(source_agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_handoffs_target ON draymond_handoffs(target_agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_handoffs_status ON draymond_handoffs(status);

CREATE TABLE IF NOT EXISTS draymond_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  icon_url TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  sector TEXT,
  invocation_method TEXT NOT NULL DEFAULT 'manual',
  invocation_config TEXT NOT NULL DEFAULT '{}',
  capabilities TEXT NOT NULL DEFAULT '[]',
  input_schema TEXT NOT NULL DEFAULT '{}',
  output_schema TEXT NOT NULL DEFAULT '{}',
  depends_on TEXT NOT NULL DEFAULT '[]',
  source_type TEXT,
  source_url TEXT,
  download_path TEXT,
  is_free INTEGER NOT NULL DEFAULT 1,
  price_cents INTEGER,
  stripe_link TEXT,
  is_integrated INTEGER NOT NULL DEFAULT 0,
  platform_page TEXT,
  linked_agent_id TEXT,
  confidence_threshold_override REAL,
  risk_level_default TEXT NOT NULL DEFAULT 'low',
  max_retries INTEGER NOT NULL DEFAULT 2,
  timeout_seconds INTEGER NOT NULL DEFAULT 60,
  is_active INTEGER NOT NULL DEFAULT 1,
  health_status TEXT NOT NULL DEFAULT 'unknown',
  last_invoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_entities_slug ON draymond_entities(slug);
CREATE INDEX IF NOT EXISTS idx_draymond_entities_kind ON draymond_entities(kind);
CREATE INDEX IF NOT EXISTS idx_draymond_entities_category ON draymond_entities(category);
CREATE INDEX IF NOT EXISTS idx_draymond_entities_active ON draymond_entities(is_active) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_draymond_entities_created ON draymond_entities(created_at DESC);

CREATE TABLE IF NOT EXISTS draymond_chains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  is_template INTEGER NOT NULL DEFAULT 1,
  template_id TEXT,
  created_by TEXT,
  agent_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  trigger_config TEXT NOT NULL DEFAULT '{}',
  input_data TEXT NOT NULL DEFAULT '{}',
  output_data TEXT NOT NULL DEFAULT '{}',
  context TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  total_steps INTEGER NOT NULL DEFAULT 0,
  completed_steps INTEGER NOT NULL DEFAULT 0,
  failed_steps INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 1,
  session_id TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_chains_slug ON draymond_chains(slug);
CREATE INDEX IF NOT EXISTS idx_draymond_chains_status ON draymond_chains(status);
CREATE INDEX IF NOT EXISTS idx_draymond_chains_template ON draymond_chains(is_template) WHERE is_template = 1;
CREATE INDEX IF NOT EXISTS idx_draymond_chains_created ON draymond_chains(created_at DESC);

CREATE TABLE IF NOT EXISTS draymond_chain_steps (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  input_mapping TEXT NOT NULL DEFAULT '{}',
  output_key TEXT,
  condition TEXT,
  depends_on_steps TEXT NOT NULL DEFAULT '[]',
  parallel_group TEXT,
  confidence_threshold REAL,
  risk_level TEXT NOT NULL DEFAULT 'low',
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  input_data TEXT NOT NULL DEFAULT '{}',
  output_data TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  action_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_chain_steps_chain ON draymond_chain_steps(chain_id);
CREATE INDEX IF NOT EXISTS idx_draymond_chain_steps_order ON draymond_chain_steps(chain_id, step_order);
CREATE INDEX IF NOT EXISTS idx_draymond_chain_steps_entity ON draymond_chain_steps(entity_id);

CREATE TABLE IF NOT EXISTS draymond_entity_relations (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (source_entity_id, target_entity_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_draymond_entity_relations_source ON draymond_entity_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_draymond_entity_relations_target ON draymond_entity_relations(target_entity_id);

CREATE TABLE IF NOT EXISTS draymond_goals (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  user_id TEXT,
  session_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  horizon TEXT NOT NULL DEFAULT 'short_term',
  status TEXT NOT NULL DEFAULT 'active',
  progress_pct REAL NOT NULL DEFAULT 0,
  success_criteria TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 5,
  enforce_on_actions INTEGER NOT NULL DEFAULT 0,
  target_date TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_goals_agent ON draymond_goals(agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_goals_status ON draymond_goals(status);

CREATE TABLE IF NOT EXISTS draymond_notifications (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'pending',
  related_agent_id TEXT,
  related_event_id TEXT,
  related_chain_id TEXT,
  error_message TEXT,
  sent_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_notifications_status ON draymond_notifications(status);
CREATE INDEX IF NOT EXISTS idx_draymond_notifications_channel ON draymond_notifications(channel);
CREATE INDEX IF NOT EXISTS idx_draymond_notifications_created ON draymond_notifications(created_at DESC);

CREATE TABLE IF NOT EXISTS draymond_scheduled_jobs (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  cron_expression TEXT NOT NULL,
  job_type TEXT NOT NULL,
  job_config TEXT NOT NULL DEFAULT '{}',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  last_run_status TEXT DEFAULT 'never',
  last_run_duration_ms INTEGER,
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 1,
  timeout_seconds INTEGER NOT NULL DEFAULT 300,
  notify_on_failure INTEGER NOT NULL DEFAULT 1,
  notify_on_success INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_jobs_enabled ON draymond_scheduled_jobs(is_enabled) WHERE is_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_draymond_jobs_next_run ON draymond_scheduled_jobs(next_run_at);

CREATE TABLE IF NOT EXISTS draymond_site_monitors (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  check_interval_seconds INTEGER NOT NULL DEFAULT 300,
  expected_status_code INTEGER NOT NULL DEFAULT 200,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  current_status TEXT NOT NULL DEFAULT 'unknown',
  last_check_at TEXT,
  last_status_code INTEGER,
  last_response_time_ms INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  max_failures_before_alert INTEGER NOT NULL DEFAULT 3,
  notify_on_down INTEGER NOT NULL DEFAULT 1,
  notify_on_recovery INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_site_monitors_enabled ON draymond_site_monitors(is_enabled) WHERE is_enabled = 1;

CREATE TABLE IF NOT EXISTS draymond_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'draymond',
  metadata TEXT NOT NULL DEFAULT '{}',
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_messages_session ON draymond_messages(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_draymond_messages_created ON draymond_messages(created_at DESC);

CREATE TABLE IF NOT EXISTS draymond_execution_logs (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_slug TEXT NOT NULL,
  chain_id TEXT,
  step_id TEXT,
  action TEXT NOT NULL DEFAULT 'default',
  success INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  input_summary TEXT NOT NULL DEFAULT '',
  output_summary TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_exec_logs_entity ON draymond_execution_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_draymond_exec_logs_entity_slug ON draymond_execution_logs(entity_slug);
CREATE INDEX IF NOT EXISTS idx_draymond_exec_logs_success ON draymond_execution_logs(success);
CREATE INDEX IF NOT EXISTS idx_draymond_exec_logs_created ON draymond_execution_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS draymond_cost_records (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  chain_id TEXT,
  step_id TEXT,
  cost_type TEXT NOT NULL DEFAULT 'llm_tokens',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  unit_count INTEGER NOT NULL DEFAULT 1,
  unit_label TEXT NOT NULL DEFAULT 'unit',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_cost_entity ON draymond_cost_records(entity_id);
CREATE INDEX IF NOT EXISTS idx_draymond_cost_type ON draymond_cost_records(cost_type);
CREATE INDEX IF NOT EXISTS idx_draymond_cost_created ON draymond_cost_records(created_at DESC);

CREATE TABLE IF NOT EXISTS draymond_event_subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  pattern TEXT NOT NULL DEFAULT '{}',
  action_type TEXT NOT NULL,
  action_config TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  last_triggered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_evt_subs_active ON draymond_event_subscriptions(is_active) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_draymond_evt_subs_action ON draymond_event_subscriptions(action_type);

CREATE TABLE IF NOT EXISTS draymond_reactive_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  data TEXT NOT NULL DEFAULT '{}',
  matched_subscriptions TEXT NOT NULL DEFAULT '[]',
  processed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draymond_reactive_evt_type ON draymond_reactive_events(event_type);
CREATE INDEX IF NOT EXISTS idx_draymond_reactive_evt_created ON draymond_reactive_events(created_at DESC);

CREATE TABLE IF NOT EXISTS draymond_memory_shares (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  owner_agent_id TEXT NOT NULL,
  granted_agent_id TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'read',
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (memory_id, granted_agent_id)
);
CREATE INDEX IF NOT EXISTS idx_draymond_mem_shares_memory ON draymond_memory_shares(memory_id);
CREATE INDEX IF NOT EXISTS idx_draymond_mem_shares_granted ON draymond_memory_shares(granted_agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_mem_shares_active ON draymond_memory_shares(is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS brain_wiki_pages (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  namespace TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  sources TEXT NOT NULL DEFAULT '{}',
  aliases TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brain_wiki_namespace ON brain_wiki_pages(namespace);
CREATE INDEX IF NOT EXISTS idx_brain_wiki_updated ON brain_wiki_pages(updated_at DESC);

CREATE TABLE IF NOT EXISTS draymond_benchmarks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  component_class TEXT NOT NULL,
  component_slug TEXT NOT NULL,
  component_name TEXT NOT NULL,
  metrics TEXT NOT NULL DEFAULT '{}',
  weakness_score REAL NOT NULL DEFAULT 0,
  trend TEXT NOT NULL DEFAULT '{}',
  deep_scores TEXT NOT NULL DEFAULT '{}',
  evidence TEXT,
  run_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_benchmarks_run ON draymond_benchmarks(run_id);
CREATE INDEX IF NOT EXISTS idx_benchmarks_class_slug ON draymond_benchmarks(component_class, component_slug);
CREATE INDEX IF NOT EXISTS idx_benchmarks_score ON draymond_benchmarks(weakness_score DESC);
CREATE INDEX IF NOT EXISTS idx_benchmarks_runat ON draymond_benchmarks(run_at DESC);

CREATE TABLE IF NOT EXISTS draymond_upgrade_queue (
  id TEXT PRIMARY KEY,
  component_class TEXT NOT NULL,
  component_slug TEXT NOT NULL,
  component_name TEXT NOT NULL,
  weakness_score REAL NOT NULL DEFAULT 0,
  reasons TEXT NOT NULL DEFAULT '[]',
  proposed_action TEXT,
  deep_scores TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_upgrade_queue_status ON draymond_upgrade_queue(status);
CREATE INDEX IF NOT EXISTS idx_upgrade_queue_score ON draymond_upgrade_queue(weakness_score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_upgrade_queue_component
  ON draymond_upgrade_queue(component_class, component_slug) WHERE status = 'queued';

-- ============================================================================
-- Local auth + purchases
-- ============================================================================

CREATE TABLE IF NOT EXISTS local_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_local_sessions_user ON local_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_local_sessions_expires ON local_sessions(expires_at);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  stripe_session_id TEXT,
  product_id TEXT,
  customer_email TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL,
  fulfilled_at TEXT
);

-- ============================================================================
-- Remote worker protocol
-- ============================================================================

CREATE TABLE IF NOT EXISTS draymond_skill_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  purpose TEXT NOT NULL DEFAULT '',
  triggers TEXT NOT NULL DEFAULT '[]',
  instructions TEXT NOT NULL DEFAULT '',
  tools TEXT NOT NULL DEFAULT '[]',
  platforms TEXT NOT NULL DEFAULT '[]',
  outputs TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL DEFAULT 'approved',
  source TEXT NOT NULL DEFAULT 'draymond',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Unique per (name, version) so concurrent upserts resolve atomically.
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_packs_name_version
  ON draymond_skill_packs(name, version);

CREATE TABLE IF NOT EXISTS draymond_worker_tasks (
  id TEXT PRIMARY KEY,
  worker_id TEXT,
  skill_pack_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  due_at TEXT,
  claimed_at TEXT,
  completed_at TEXT,
  result TEXT NOT NULL DEFAULT '{}',
  artifact_refs TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_worker_tasks_status ON draymond_worker_tasks(status);

CREATE TABLE IF NOT EXISTS draymond_worker_proposals (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  pack TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS science_experiments (
  experiment_id TEXT PRIMARY KEY,
  goal_id TEXT,
  hypothesis_id TEXT,
  domain TEXT NOT NULL DEFAULT 'sports',
  type TEXT NOT NULL DEFAULT 'analysis',
  model_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  result TEXT NOT NULL DEFAULT '{}',
  evidence_tier TEXT NOT NULL DEFAULT 'E3',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_science_experiments_goal ON science_experiments(goal_id);
CREATE INDEX IF NOT EXISTS idx_science_experiments_status ON science_experiments(status);

-- ============================================================================
-- Command Center — built-in CRM + SEO task feed
-- ============================================================================

CREATE TABLE IF NOT EXISTS command_leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  stage TEXT NOT NULL DEFAULT 'new',
  value_cents INTEGER NOT NULL DEFAULT 0,
  owner TEXT,
  source TEXT,
  notes TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  next_follow_up_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_command_leads_stage ON command_leads(stage);
CREATE INDEX IF NOT EXISTS idx_command_leads_owner ON command_leads(owner);
CREATE INDEX IF NOT EXISTS idx_command_leads_created ON command_leads(created_at DESC);

CREATE TABLE IF NOT EXISTS science_insights (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'bbtech',
  session_id TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT 'sports',
  report TEXT NOT NULL DEFAULT '{}',
  evidence_tier TEXT NOT NULL DEFAULT 'E3',
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_science_insights_source ON science_insights(source);
CREATE INDEX IF NOT EXISTS idx_science_insights_generated ON science_insights(generated_at DESC);
-- Idempotency key: a re-persisted report (same source+session+generatedAt)
-- upserts over the original row instead of duplicating it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_science_insights_key
  ON science_insights(source, session_id, generated_at);

CREATE TABLE IF NOT EXISTS science_gaps (
  gap_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  source_ref TEXT,
  evidence_tier TEXT NOT NULL DEFAULT 'E3',
  severity INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'open',
  payload TEXT NOT NULL DEFAULT '{}',
  dispatched_at TEXT,
  detected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_science_gaps_status ON science_gaps(status);
CREATE INDEX IF NOT EXISTS idx_science_gaps_kind ON science_gaps(kind);
CREATE INDEX IF NOT EXISTS idx_science_gaps_severity ON science_gaps(severity DESC);

CREATE TABLE IF NOT EXISTS command_seo_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',
  owner TEXT,
  is_done INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  due_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_command_seo_tasks_status ON command_seo_tasks(status);
CREATE INDEX IF NOT EXISTS idx_command_seo_tasks_priority ON command_seo_tasks(priority);

-- ============================================================================
-- Trends, Insights & Discoveries (TID) Engine
-- ============================================================================

CREATE TABLE IF NOT EXISTS tid_signals (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  component TEXT,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tid_signals_source ON tid_signals(source);
CREATE INDEX IF NOT EXISTS idx_tid_signals_component ON tid_signals(component);
CREATE INDEX IF NOT EXISTS idx_tid_signals_metric ON tid_signals(metric);
CREATE INDEX IF NOT EXISTS idx_tid_signals_created ON tid_signals(created_at DESC);

CREATE TABLE IF NOT EXISTS tid_insights (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence TEXT NOT NULL DEFAULT '{}',
  suggested_action TEXT,
  status TEXT NOT NULL DEFAULT 'detected',
  created_at TEXT NOT NULL,
  promoted_at TEXT,
  measured_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tid_insights_status ON tid_insights(status);
CREATE INDEX IF NOT EXISTS idx_tid_insights_confidence ON tid_insights(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_tid_insights_created ON tid_insights(created_at DESC);

CREATE TABLE IF NOT EXISTS tid_discoveries (
  id TEXT PRIMARY KEY,
  insight_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_detail TEXT NOT NULL DEFAULT '{}',
  dispatched_at TEXT NOT NULL,
  outcome TEXT,
  outcome_score REAL,
  measured_at TEXT,
  status TEXT NOT NULL DEFAULT 'dispatched'
);
CREATE INDEX IF NOT EXISTS idx_tid_discoveries_status ON tid_discoveries(status);
CREATE INDEX IF NOT EXISTS idx_tid_discoveries_insight ON tid_discoveries(insight_id);
CREATE INDEX IF NOT EXISTS idx_tid_discoveries_dispatched ON tid_discoveries(dispatched_at DESC);
`;

