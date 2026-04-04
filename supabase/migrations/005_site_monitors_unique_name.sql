-- ============================================================================
-- Migration 005: Add unique constraint on draymond_site_monitors.name
-- ============================================================================
-- Required for upsert-by-name in seedAgentMonitors() to work atomically.
-- Without this, concurrent seed calls could create duplicate monitors.
-- ============================================================================

ALTER TABLE public.draymond_site_monitors
  ADD CONSTRAINT draymond_site_monitors_name_key UNIQUE (name);
