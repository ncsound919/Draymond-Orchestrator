-- Alter run_id to text (human-readable run ids like entity-20260807-010203).
alter table public.draymond_benchmarks alter column run_id type text;
