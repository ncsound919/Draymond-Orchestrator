-- ============================================================================
-- DRAYMOND ORCHESTRATION SYSTEM — Migration 004
-- Creates all tables for the intelligent agent supervision layer:
--   draymond_agents, draymond_sessions, draymond_events, draymond_actions,
--   draymond_memory, draymond_handoffs, draymond_entities, draymond_chains,
--   draymond_chain_steps, draymond_entity_relations, draymond_notifications,
--   draymond_scheduled_jobs
-- Plus the SQL function draymond_get_chain_execution_plan()
-- ============================================================================

-- ============================================================================
-- DRAYMOND AGENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  version text NOT NULL DEFAULT '1.0.0',
  capabilities text[] NOT NULL DEFAULT '{}',
  model_provider text,
  model_id text,
  fallback_model_provider text,
  fallback_model_id text,
  config jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','degraded','stalled','crashed','recovering','suspended','terminated')),
  last_heartbeat timestamptz,
  heartbeat_interval_seconds int NOT NULL DEFAULT 60,
  max_consecutive_errors int NOT NULL DEFAULT 5,
  consecutive_errors int NOT NULL DEFAULT 0,
  confidence_threshold_auto numeric(4,3) NOT NULL DEFAULT 0.850,
  confidence_threshold_review numeric(4,3) NOT NULL DEFAULT 0.600,
  max_retries int NOT NULL DEFAULT 3,
  retry_backoff_ms int NOT NULL DEFAULT 1000,
  auto_recovery_enabled boolean NOT NULL DEFAULT true,
  fallback_agent_id uuid REFERENCES public.draymond_agents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_agents_slug ON public.draymond_agents(slug);
CREATE INDEX IF NOT EXISTS idx_draymond_agents_status ON public.draymond_agents(status);

CREATE TRIGGER draymond_agents_updated_at
  BEFORE UPDATE ON public.draymond_agents
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- DRAYMOND SESSIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.draymond_agents(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  trigger_source text,
  parent_session_id uuid REFERENCES public.draymond_sessions(id) ON DELETE SET NULL,
  total_actions int NOT NULL DEFAULT 0,
  successful_actions int NOT NULL DEFAULT 0,
  failed_actions int NOT NULL DEFAULT 0,
  human_reviews_requested int NOT NULL DEFAULT 0,
  avg_confidence numeric(4,3),
  state_snapshot jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_sessions_agent ON public.draymond_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_sessions_active ON public.draymond_sessions(is_active) WHERE is_active = true;

CREATE TRIGGER draymond_sessions_updated_at
  BEFORE UPDATE ON public.draymond_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- DRAYMOND EVENTS (audit trail / explainability log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.draymond_agents(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.draymond_sessions(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL
    CHECK (category IN ('health','action','decision','hallucination','recovery','handoff','memory','confidence','security','goal','human_review')),
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('debug','info','warning','error','critical')),
  event_type text NOT NULL,
  message text NOT NULL,
  context_used jsonb NOT NULL DEFAULT '{}',
  alternatives_considered jsonb NOT NULL DEFAULT '[]',
  reasoning text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_events_agent ON public.draymond_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_events_session ON public.draymond_events(session_id);
CREATE INDEX IF NOT EXISTS idx_draymond_events_category ON public.draymond_events(category);
CREATE INDEX IF NOT EXISTS idx_draymond_events_severity ON public.draymond_events(severity);
CREATE INDEX IF NOT EXISTS idx_draymond_events_created ON public.draymond_events(created_at DESC);

-- ============================================================================
-- DRAYMOND ACTIONS (confidence-gated execution log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.draymond_agents(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.draymond_sessions(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  description text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  confidence_score numeric(4,3) NOT NULL DEFAULT 0.500,
  risk_level text NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('safe','low','medium','high','critical')),
  confidence_reasoning text,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','rejected','auto_executed','executing','completed','failed','expired')),
  requires_human_review boolean NOT NULL DEFAULT false,
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,
  executed_at timestamptz,
  result jsonb,
  error_message text,
  goal_id uuid,
  goal_alignment_score numeric(4,3),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_actions_agent ON public.draymond_actions(agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_actions_status ON public.draymond_actions(status);
CREATE INDEX IF NOT EXISTS idx_draymond_actions_review ON public.draymond_actions(requires_human_review) WHERE requires_human_review = true;

CREATE TRIGGER draymond_actions_updated_at
  BEFORE UPDATE ON public.draymond_actions
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- DRAYMOND MEMORY (tiered memory with decay)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.draymond_agents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}',
  summary text,
  tier text NOT NULL DEFAULT 'contextual'
    CHECK (tier IN ('core','important','contextual','ephemeral')),
  importance_score numeric(4,3) NOT NULL DEFAULT 0.500,
  decay_rate numeric(6,5) NOT NULL DEFAULT 0.01000,
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  access_count int NOT NULL DEFAULT 0,
  source_session_id uuid REFERENCES public.draymond_sessions(id) ON DELETE SET NULL,
  source_event text,
  is_active boolean NOT NULL DEFAULT true,
  expired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_memory_agent_user ON public.draymond_memory(agent_id, user_id);
CREATE INDEX IF NOT EXISTS idx_draymond_memory_key ON public.draymond_memory(key);
CREATE INDEX IF NOT EXISTS idx_draymond_memory_tier ON public.draymond_memory(tier);
CREATE INDEX IF NOT EXISTS idx_draymond_memory_active ON public.draymond_memory(is_active) WHERE is_active = true;

CREATE TRIGGER draymond_memory_updated_at
  BEFORE UPDATE ON public.draymond_memory
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- DRAYMOND HANDOFFS (agent-to-agent handoff protocol)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agent_id uuid NOT NULL REFERENCES public.draymond_agents(id) ON DELETE CASCADE,
  source_session_id uuid REFERENCES public.draymond_sessions(id) ON DELETE SET NULL,
  target_agent_id uuid NOT NULL REFERENCES public.draymond_agents(id) ON DELETE CASCADE,
  target_session_id uuid REFERENCES public.draymond_sessions(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated','accepted','in_progress','completed','failed','rolled_back')),
  state_snapshot jsonb NOT NULL DEFAULT '{}',
  context_summary text,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  retry_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_handoffs_source ON public.draymond_handoffs(source_agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_handoffs_target ON public.draymond_handoffs(target_agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_handoffs_status ON public.draymond_handoffs(status);

CREATE TRIGGER draymond_handoffs_updated_at
  BEFORE UPDATE ON public.draymond_handoffs
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- DRAYMOND ENTITIES (unified registry for agents, tools, skills, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('agent','tool','skill','extension','mcp_server','service','pipeline')),
  description text,
  version text NOT NULL DEFAULT '1.0.0',
  icon_url text,
  tags text[] NOT NULL DEFAULT '{}',
  category text,
  sector text,
  invocation_method text NOT NULL DEFAULT 'manual'
    CHECK (invocation_method IN ('api_call','http_api','cli_command','subprocess','python_module','node_module','mcp_tool','mcp_stdio','internal','manual','webhook','message_gateway')),
  invocation_config jsonb NOT NULL DEFAULT '{}',
  capabilities text[] NOT NULL DEFAULT '{}',
  input_schema jsonb NOT NULL DEFAULT '{}',
  output_schema jsonb NOT NULL DEFAULT '{}',
  depends_on text[] NOT NULL DEFAULT '{}',
  source_type text,
  source_url text,
  download_path text,
  is_free boolean NOT NULL DEFAULT true,
  price_cents int,
  stripe_link text,
  is_integrated boolean NOT NULL DEFAULT false,
  platform_page text,
  linked_agent_id uuid REFERENCES public.draymond_agents(id) ON DELETE SET NULL,
  confidence_threshold_override numeric(4,3),
  risk_level_default text NOT NULL DEFAULT 'low',
  max_retries int NOT NULL DEFAULT 2,
  timeout_seconds int NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT true,
  health_status text NOT NULL DEFAULT 'unknown',
  last_invoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_entities_slug ON public.draymond_entities(slug);
CREATE INDEX IF NOT EXISTS idx_draymond_entities_kind ON public.draymond_entities(kind);
CREATE INDEX IF NOT EXISTS idx_draymond_entities_category ON public.draymond_entities(category);
CREATE INDEX IF NOT EXISTS idx_draymond_entities_active ON public.draymond_entities(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_draymond_entities_tags ON public.draymond_entities USING gin(tags);

CREATE TRIGGER draymond_entities_updated_at
  BEFORE UPDATE ON public.draymond_entities
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- DRAYMOND CHAINS (composable workflows / pipelines)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  version text NOT NULL DEFAULT '1.0.0',
  is_template boolean NOT NULL DEFAULT true,
  template_id uuid REFERENCES public.draymond_chains(id) ON DELETE SET NULL,
  created_by text,
  agent_id uuid REFERENCES public.draymond_agents(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','running','paused','completed','failed','cancelled','archived')),
  trigger_type text NOT NULL DEFAULT 'manual',
  trigger_config jsonb NOT NULL DEFAULT '{}',
  input_data jsonb NOT NULL DEFAULT '{}',
  output_data jsonb NOT NULL DEFAULT '{}',
  context jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz,
  completed_at timestamptz,
  total_steps int NOT NULL DEFAULT 0,
  completed_steps int NOT NULL DEFAULT 0,
  failed_steps int NOT NULL DEFAULT 0,
  total_duration_ms bigint,
  error_message text,
  retry_count int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 1,
  session_id uuid REFERENCES public.draymond_sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_chains_slug ON public.draymond_chains(slug);
CREATE INDEX IF NOT EXISTS idx_draymond_chains_status ON public.draymond_chains(status);
CREATE INDEX IF NOT EXISTS idx_draymond_chains_template ON public.draymond_chains(is_template) WHERE is_template = true;

CREATE TRIGGER draymond_chains_updated_at
  BEFORE UPDATE ON public.draymond_chains
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- DRAYMOND CHAIN STEPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_chain_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES public.draymond_chains(id) ON DELETE CASCADE,
  step_order int NOT NULL,
  name text NOT NULL,
  description text,
  entity_id uuid NOT NULL REFERENCES public.draymond_entities(id) ON DELETE RESTRICT,
  action text NOT NULL,
  input_mapping jsonb NOT NULL DEFAULT '{}',
  output_key text,
  condition jsonb,
  depends_on_steps uuid[] NOT NULL DEFAULT '{}',
  parallel_group text,
  confidence_threshold numeric(4,3),
  risk_level text NOT NULL DEFAULT 'low',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','waiting','running','completed','failed','skipped','blocked','pending_review','approved','rejected','retrying')),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms bigint,
  input_data jsonb NOT NULL DEFAULT '{}',
  output_data jsonb NOT NULL DEFAULT '{}',
  error_message text,
  retry_count int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 2,
  action_id uuid REFERENCES public.draymond_actions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_chain_steps_chain ON public.draymond_chain_steps(chain_id);
CREATE INDEX IF NOT EXISTS idx_draymond_chain_steps_order ON public.draymond_chain_steps(chain_id, step_order);
CREATE INDEX IF NOT EXISTS idx_draymond_chain_steps_entity ON public.draymond_chain_steps(entity_id);

CREATE TRIGGER draymond_chain_steps_updated_at
  BEFORE UPDATE ON public.draymond_chain_steps
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- DRAYMOND ENTITY RELATIONS (dependency/composition graph)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_entity_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entity_id uuid NOT NULL REFERENCES public.draymond_entities(id) ON DELETE CASCADE,
  target_entity_id uuid NOT NULL REFERENCES public.draymond_entities(id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_entity_id, target_entity_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_draymond_entity_relations_source ON public.draymond_entity_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_draymond_entity_relations_target ON public.draymond_entity_relations(target_entity_id);

-- ============================================================================
-- DRAYMOND GOALS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.draymond_agents(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.draymond_sessions(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  horizon text NOT NULL DEFAULT 'short_term'
    CHECK (horizon IN ('immediate','short_term','medium_term','long_term')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','completed','abandoned')),
  progress_pct numeric(5,2) NOT NULL DEFAULT 0.00,
  success_criteria jsonb NOT NULL DEFAULT '[]',
  priority int NOT NULL DEFAULT 5,
  enforce_on_actions boolean NOT NULL DEFAULT false,
  target_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_goals_agent ON public.draymond_goals(agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_goals_status ON public.draymond_goals(status);

CREATE TRIGGER draymond_goals_updated_at
  BEFORE UPDATE ON public.draymond_goals
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- DRAYMOND NOTIFICATIONS (email/push alert log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email','sms','push','slack','discord','webhook')),
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  type text NOT NULL DEFAULT 'custom'
    CHECK (type IN ('agent_failure','chain_completed','chain_failed','trade_signal','site_down','site_recovered','health_summary','custom')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  related_agent_id uuid REFERENCES public.draymond_agents(id) ON DELETE SET NULL,
  related_event_id uuid REFERENCES public.draymond_events(id) ON DELETE SET NULL,
  related_chain_id uuid REFERENCES public.draymond_chains(id) ON DELETE SET NULL,
  error_message text,
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_notifications_status ON public.draymond_notifications(status);
CREATE INDEX IF NOT EXISTS idx_draymond_notifications_channel ON public.draymond_notifications(channel);
CREATE INDEX IF NOT EXISTS idx_draymond_notifications_created ON public.draymond_notifications(created_at DESC);

-- ============================================================================
-- DRAYMOND SCHEDULED JOBS (cron / autonomous scheduler)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_scheduled_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  cron_expression text NOT NULL,
  job_type text NOT NULL
    CHECK (job_type IN ('chain','health_check','notification','custom')),
  job_config jsonb NOT NULL DEFAULT '{}',
  is_enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_run_status text DEFAULT 'never'
    CHECK (last_run_status IN ('never','running','success','failed','skipped')),
  last_run_duration_ms bigint,
  last_error text,
  run_count int NOT NULL DEFAULT 0,
  fail_count int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 1,
  timeout_seconds int NOT NULL DEFAULT 300,
  notify_on_failure boolean NOT NULL DEFAULT true,
  notify_on_success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_jobs_enabled ON public.draymond_scheduled_jobs(is_enabled) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_draymond_jobs_next_run ON public.draymond_scheduled_jobs(next_run_at);

CREATE TRIGGER draymond_scheduled_jobs_updated_at
  BEFORE UPDATE ON public.draymond_scheduled_jobs
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- DRAYMOND WEBSITE MONITORS (uptime / deploy tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_site_monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  check_interval_seconds int NOT NULL DEFAULT 300,
  expected_status_code int NOT NULL DEFAULT 200,
  timeout_ms int NOT NULL DEFAULT 10000,
  is_enabled boolean NOT NULL DEFAULT true,
  current_status text NOT NULL DEFAULT 'unknown'
    CHECK (current_status IN ('up','down','degraded','unknown')),
  last_check_at timestamptz,
  last_status_code int,
  last_response_time_ms int,
  consecutive_failures int NOT NULL DEFAULT 0,
  max_failures_before_alert int NOT NULL DEFAULT 3,
  notify_on_down boolean NOT NULL DEFAULT true,
  notify_on_recovery boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_site_monitors_enabled ON public.draymond_site_monitors(is_enabled) WHERE is_enabled = true;

CREATE TRIGGER draymond_site_monitors_updated_at
  BEFORE UPDATE ON public.draymond_site_monitors
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- SQL FUNCTION: draymond_get_chain_execution_plan
-- Returns steps joined with entity info for display
-- ============================================================================

CREATE OR REPLACE FUNCTION public.draymond_get_chain_execution_plan(p_chain_id uuid)
RETURNS TABLE(
  step_id uuid,
  step_order int,
  step_name text,
  entity_id uuid,
  entity_name text,
  entity_kind text,
  parallel_group text,
  depends_on_steps uuid[],
  status text
) LANGUAGE sql STABLE AS $$
  SELECT
    cs.id          AS step_id,
    cs.step_order,
    cs.name        AS step_name,
    cs.entity_id,
    e.name         AS entity_name,
    e.kind         AS entity_kind,
    cs.parallel_group,
    cs.depends_on_steps,
    cs.status
  FROM public.draymond_chain_steps cs
  JOIN public.draymond_entities e ON e.id = cs.entity_id
  WHERE cs.chain_id = p_chain_id
  ORDER BY cs.step_order, cs.parallel_group NULLS LAST;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- For the autonomous system, most operations use the service role key
-- (bypasses RLS). These policies allow authenticated users to read.
-- ============================================================================

ALTER TABLE public.draymond_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_chain_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_entity_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_site_monitors ENABLE ROW LEVEL SECURITY;

-- Read access for authenticated users
CREATE POLICY "Authenticated read draymond_agents" ON public.draymond_agents FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_sessions" ON public.draymond_sessions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_events" ON public.draymond_events FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_actions" ON public.draymond_actions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_memory" ON public.draymond_memory FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Authenticated read draymond_handoffs" ON public.draymond_handoffs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_entities" ON public.draymond_entities FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_chains" ON public.draymond_chains FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_chain_steps" ON public.draymond_chain_steps FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_entity_relations" ON public.draymond_entity_relations FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_goals" ON public.draymond_goals FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_notifications" ON public.draymond_notifications FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_scheduled_jobs" ON public.draymond_scheduled_jobs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read draymond_site_monitors" ON public.draymond_site_monitors FOR SELECT USING (auth.role() = 'authenticated');

-- Service role handles all writes (bypasses RLS)
-- No write policies needed for normal users — all writes go through API routes using service role key
