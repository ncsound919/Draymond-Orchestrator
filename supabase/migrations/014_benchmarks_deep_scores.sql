-- ============================================================================
-- DRAYMOND BENCHMARK DEEP SCORES — persist RepoRank / Grader / Vibe-Reality
-- results on each benchmark row so the system keeps a baseline and can
-- recognize % gains between runs.
-- ============================================================================

alter table public.draymond_benchmarks add column if not exists deep_scores jsonb not null default '{}';
