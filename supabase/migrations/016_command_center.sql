-- ============================================================================
-- DRAYMOND ORCHESTRATION SYSTEM — Migration 016
-- Command Center: built-in CRM lead board + SEO task feed tables.
-- Local SQLite schema lives in src/lib/db/schema.ts; this file is Postgres
-- parity for Supabase-hosted deployments.
-- ============================================================================

CREATE TABLE IF NOT EXISTS command_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  stage TEXT NOT NULL DEFAULT 'new',
  value_cents BIGINT NOT NULL DEFAULT 0,
  owner TEXT,
  source TEXT,
  notes JSONB NOT NULL DEFAULT '[]',
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  next_follow_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_command_leads_stage ON command_leads(stage);
CREATE INDEX IF NOT EXISTS idx_command_leads_owner ON command_leads(owner);
CREATE INDEX IF NOT EXISTS idx_command_leads_created ON command_leads(created_at DESC);

CREATE TABLE IF NOT EXISTS command_seo_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'todo',
  owner TEXT,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}',
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_command_seo_tasks_status ON command_seo_tasks(status);
CREATE INDEX IF NOT EXISTS idx_command_seo_tasks_priority ON command_seo_tasks(priority);
