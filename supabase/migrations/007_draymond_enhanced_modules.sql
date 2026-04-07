-- ============================================================================
-- DRAYMOND ORCHESTRATION SYSTEM — Migration 007
-- Enhanced Modules: Execution Logs, Cost Records, Event Subscriptions,
-- Reactive Events, and Memory Shares
-- ============================================================================
-- New tables for the 6 enhancement modules:
--   - draymond_execution_logs     (Adaptive Confidence Scoring + Analytics)
--   - draymond_cost_records       (Observability & Analytics)
--   - draymond_event_subscriptions (Reactive Event System)
--   - draymond_reactive_events     (Reactive Event System)
--   - draymond_memory_shares       (Memory Intelligence)
-- ============================================================================

-- ============================================================================
-- DRAYMOND EXECUTION LOGS
-- Feeds the Adaptive Confidence Scoring and Analytics systems.
-- Every entity invocation (success or failure) is recorded here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.draymond_entities(id) ON DELETE CASCADE,
  entity_slug text NOT NULL,
  chain_id uuid REFERENCES public.draymond_chains(id) ON DELETE SET NULL,
  step_id uuid REFERENCES public.draymond_chain_steps(id) ON DELETE SET NULL,
  action text NOT NULL DEFAULT 'default',
  success boolean NOT NULL,
  duration_ms bigint NOT NULL DEFAULT 0,
  input_summary text NOT NULL DEFAULT '',
  output_summary text NOT NULL DEFAULT '',
  error_message text,
  cost_cents int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_exec_logs_entity
  ON public.draymond_execution_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_draymond_exec_logs_entity_slug
  ON public.draymond_execution_logs(entity_slug);
CREATE INDEX IF NOT EXISTS idx_draymond_exec_logs_chain
  ON public.draymond_execution_logs(chain_id)
  WHERE chain_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_draymond_exec_logs_success
  ON public.draymond_execution_logs(success);
CREATE INDEX IF NOT EXISTS idx_draymond_exec_logs_created
  ON public.draymond_execution_logs(created_at DESC);

-- ============================================================================
-- DRAYMOND COST RECORDS
-- Tracks cost per entity execution for the Analytics module.
-- Supports LLM token costs, API call costs, compute, etc.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_cost_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.draymond_entities(id) ON DELETE CASCADE,
  chain_id uuid REFERENCES public.draymond_chains(id) ON DELETE SET NULL,
  step_id uuid REFERENCES public.draymond_chain_steps(id) ON DELETE SET NULL,
  cost_type text NOT NULL DEFAULT 'llm_tokens'
    CHECK (cost_type IN ('llm_tokens', 'api_call', 'compute', 'storage', 'bandwidth', 'other')),
  amount_cents int NOT NULL DEFAULT 0,
  unit_count int NOT NULL DEFAULT 1,
  unit_label text NOT NULL DEFAULT 'unit',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_cost_entity
  ON public.draymond_cost_records(entity_id);
CREATE INDEX IF NOT EXISTS idx_draymond_cost_type
  ON public.draymond_cost_records(cost_type);
CREATE INDEX IF NOT EXISTS idx_draymond_cost_created
  ON public.draymond_cost_records(created_at DESC);

-- ============================================================================
-- DRAYMOND EVENT SUBSCRIPTIONS
-- Reactive Event System — defines patterns that trigger actions when events fire.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_event_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  pattern jsonb NOT NULL DEFAULT '{}',
  action_type text NOT NULL
    CHECK (action_type IN ('invoke_entity', 'execute_chain', 'emit_event', 'webhook')),
  action_config jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_by text,
  trigger_count int NOT NULL DEFAULT 0,
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_evt_subs_active
  ON public.draymond_event_subscriptions(is_active)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_draymond_evt_subs_action
  ON public.draymond_event_subscriptions(action_type);

CREATE TRIGGER draymond_event_subscriptions_updated_at
  BEFORE UPDATE ON public.draymond_event_subscriptions
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- DRAYMOND REACTIVE EVENTS
-- Log of events processed by the Reactive Event System.
-- Records which subscriptions were matched and when the event was processed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_reactive_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  source text NOT NULL DEFAULT 'unknown',
  data jsonb NOT NULL DEFAULT '{}',
  matched_subscriptions uuid[] NOT NULL DEFAULT '{}',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_reactive_evt_type
  ON public.draymond_reactive_events(event_type);
CREATE INDEX IF NOT EXISTS idx_draymond_reactive_evt_created
  ON public.draymond_reactive_events(created_at DESC);

-- ============================================================================
-- DRAYMOND MEMORY SHARES
-- Cross-agent memory sharing with permission grants.
-- Allows agents to share specific memories with other agents.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_memory_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES public.draymond_memory(id) ON DELETE CASCADE,
  owner_agent_id uuid NOT NULL REFERENCES public.draymond_agents(id) ON DELETE CASCADE,
  granted_agent_id uuid NOT NULL REFERENCES public.draymond_agents(id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'read'
    CHECK (permission IN ('read', 'read_write')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(memory_id, granted_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_draymond_mem_shares_memory
  ON public.draymond_memory_shares(memory_id);
CREATE INDEX IF NOT EXISTS idx_draymond_mem_shares_granted
  ON public.draymond_memory_shares(granted_agent_id);
CREATE INDEX IF NOT EXISTS idx_draymond_mem_shares_active
  ON public.draymond_memory_shares(is_active)
  WHERE is_active = true;

CREATE TRIGGER draymond_memory_shares_updated_at
  BEFORE UPDATE ON public.draymond_memory_shares
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- Service role handles writes; authenticated users get read access.
-- ============================================================================

ALTER TABLE public.draymond_execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_cost_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_reactive_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draymond_memory_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read draymond_execution_logs"
  ON public.draymond_execution_logs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read draymond_cost_records"
  ON public.draymond_cost_records FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read draymond_event_subscriptions"
  ON public.draymond_event_subscriptions FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read draymond_reactive_events"
  ON public.draymond_reactive_events FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read draymond_memory_shares"
  ON public.draymond_memory_shares FOR SELECT
  USING (auth.role() = 'authenticated');
