-- Migration 002: Fix posts schema to align with API contract
-- The API routes use 'content' and 'is_anonymous'; the initial schema used 'body'
-- This migration renames body -> content and adds is_anonymous

-- Rename body column to content to match the API
alter table public.posts rename column body to content;

-- Add is_anonymous flag (API sends this on post creation)
alter table public.posts
  add column if not exists is_anonymous boolean not null default false;

-- Add title nullable to match API (title was NOT NULL in 001, but API allows null)
alter table public.posts
  alter column title drop not null;

-- Add composite index for efficient feed queries
create index if not exists posts_module_status_created_idx
  on public.posts(module, status, created_at desc);

-- Add index for anonymous posts (needed for moderation queries)
create index if not exists posts_is_anonymous_idx
  on public.posts(is_anonymous)
  where is_anonymous = true;
