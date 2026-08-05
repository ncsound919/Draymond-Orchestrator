-- ============================================================================
-- DRAYMOND ORCHESTRATION SYSTEM — Migration 010
-- Adds the 'memo' type to draymond_notifications so low-urgency memo/update
-- emails (sendMemo) can be logged. Migration 004 defined the CHECK constraint
-- without 'memo'.
-- ============================================================================

ALTER TABLE public.draymond_notifications
  DROP CONSTRAINT draymond_notifications_type_check;

ALTER TABLE public.draymond_notifications
  ADD CONSTRAINT draymond_notifications_type_check
  CHECK (type IN (
    'agent_failure', 'chain_completed', 'chain_failed', 'trade_signal',
    'site_down', 'site_recovered', 'health_summary', 'memo', 'custom'
  ));
