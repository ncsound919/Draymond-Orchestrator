-- ============================================================================
-- DRAYMOND BRAIN WIKI — Markdown knowledge cache
-- Mirrors the deterministic-brain wiki tree so agents/dashboard can query it.
-- Markdown files in the brain package are the source of truth; the sync
-- script (scripts/sync-wiki-to-supabase.mjs) upserts them here.
-- ============================================================================

create table if not exists public.brain_wiki_pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  namespace text not null,
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  sources jsonb not null default '{}',
  aliases text[] not null default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_brain_wiki_namespace on public.brain_wiki_pages(namespace);
create index if not exists idx_brain_wiki_tags on public.brain_wiki_pages using gin(tags);
create index if not exists idx_brain_wiki_updated on public.brain_wiki_pages(updated_at desc);

alter table public.brain_wiki_pages enable row level security;

create policy "Authenticated read brain_wiki_pages"
  on public.brain_wiki_pages for select
  using (auth.role() = 'authenticated');

-- Writes via service role only (bypasses RLS); no user write policies.
