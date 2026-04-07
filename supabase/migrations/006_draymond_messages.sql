-- ============================================================================
-- DRAYMOND MESSAGES — Migration 005
-- Chat history sync between Open Chat and Draymond Orchestrator.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.draymond_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  protocol text NOT NULL DEFAULT 'draymond',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draymond_messages_session ON public.draymond_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_draymond_messages_created ON public.draymond_messages(created_at DESC);
