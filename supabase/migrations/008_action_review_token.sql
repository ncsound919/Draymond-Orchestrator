-- ============================================================================
-- DRAYMOND ORCHESTRATION SYSTEM — Migration 008
-- Adds per-action review tokens for ntfy push-approval (human-in-the-loop).
--
-- The review token is a random 64-char hex secret that travels to the
-- phone via the ntfy notification's HTTP action header. It grants the
-- bearer the ability to review exactly ONE action. Tokens expire after
-- 48 hours regardless of use.
--
-- Columns:
--   review_token            random 64-char hex (randomBytes(32).toString('hex'))
--   review_token_expires_at timestamptz TTL for the token
-- ============================================================================

ALTER TABLE public.draymond_actions
  ADD COLUMN IF NOT EXISTS review_token text,
  ADD COLUMN IF NOT EXISTS review_token_expires_at timestamptz;

-- Lookup by token is only needed while a review is pending.
CREATE INDEX IF NOT EXISTS idx_draymond_actions_review_token
  ON public.draymond_actions(review_token)
  WHERE review_token IS NOT NULL;
