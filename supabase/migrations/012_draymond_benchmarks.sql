-- ============================================================================
-- DRAYMOND BENCHMARKING — trend history + upgrade queue
-- ============================================================================

create table if not exists public.draymond_benchmarks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  component_class text not null
    check (component_class in ('entity','site','cron','chain')),
  component_slug text not null,
  component_name text not null,
  metrics jsonb not null default '{}',
  weakness_score numeric(6,3) not null default 0,
  trend jsonb not null default '{}',
  evidence text,
  run_at timestamptz not null default now()
);

create index if not exists idx_benchmarks_run on public.draymond_benchmarks(run_id);
create index if not exists idx_benchmarks_class_slug on public.draymond_benchmarks(component_class, component_slug);
create index if not exists idx_benchmarks_score on public.draymond_benchmarks(weakness_score desc);
create index if not exists idx_benchmarks_runat on public.draymond_benchmarks(run_at desc);

create table if not exists public.draymond_upgrade_queue (
  id uuid primary key default gen_random_uuid(),
  component_class text not null,
  component_slug text not null,
  component_name text not null,
  weakness_score numeric(6,3) not null default 0,
  reasons jsonb not null default '[]',
  proposed_action text,
  deep_scores jsonb not null default '{}',
  status text not null default 'queued'
    check (status in ('queued','in_progress','completed','dismissed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_upgrade_queue_status on public.draymond_upgrade_queue(status);
create index if not exists idx_upgrade_queue_score on public.draymond_upgrade_queue(weakness_score desc);
create unique index if not exists uq_upgrade_queue_component
  on public.draymond_upgrade_queue(component_class, component_slug) where status = 'queued';

alter table public.draymond_benchmarks enable row level security;
alter table public.draymond_upgrade_queue enable row level security;

create policy "Authenticated read draymond_benchmarks"
  on public.draymond_benchmarks for select using (auth.role() = 'authenticated');
create policy "Authenticated read draymond_upgrade_queue"
  on public.draymond_upgrade_queue for select using (auth.role() = 'authenticated');

-- Writes via service role only (bypasses RLS).
