-- ============================================================================
-- DRAYMOND ORCHESTRATION SYSTEM — Baseline migration
-- Restores the public.handle_updated_at() trigger function that migration 001
-- (removed in commit b044754) used to create. Migrations 004 and 007 attach
-- BEFORE UPDATE triggers that call this function, so it must exist first on a
-- fresh database.
-- ============================================================================

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
