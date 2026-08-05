-- ============================================================================
-- DRAYMOND ORCHESTRATION SYSTEM — Migration 009
-- Registers the AetherDesk Call Center as a Draymond entity + backing agent
-- so the Intelligent Task Router can discover it (router prompt lists active
-- entities) and the confidence gate can queue high-risk operations for review.
--
-- NOTE: draymond_agents has NO is_active column (migration 004). Only the
-- entity row carries is_active.
-- ============================================================================

INSERT INTO public.draymond_entities (
  slug, name, kind, description, invocation_method, invocation_config,
  capabilities, risk_level_default, is_active, health_status
) VALUES (
  'aetherdesk', 'AetherDesk Call Center', 'service',
  'Call center SaaS. Operations: create_agent, update_agent, delete_agent, list_agents, create_campaign, update_campaign, launch_campaign, list_campaigns, list_leads, list_calls, health.',
  'internal', '{}',
  ARRAY['agents','campaigns','leads','calls','health'],
  'medium', true, 'unknown'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  capabilities = EXCLUDED.capabilities,
  risk_level_default = EXCLUDED.risk_level_default,
  is_active = true;

INSERT INTO public.draymond_agents (name, slug, confidence_threshold_auto, confidence_threshold_review, status)
VALUES ('AetherDesk Control', 'aetherdesk', 0.9, 0.5, 'active')
ON CONFLICT (slug) DO NOTHING;
