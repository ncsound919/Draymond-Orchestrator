-- The Uplift Lab — Initial Schema
-- Run this in your Supabase SQL editor or via migrations

-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Enums
create type uplift_role as enum (
  'community_member', 'educator', 'provider', 'entrepreneur',
  'legal_advocate', 'organizer', 'admin', 'municipal_partner'
);

create type post_type as enum (
  'story', 'mutual_aid_request', 'mutual_aid_offer', 'event', 'announcement'
);

create type uplift_module as enum (
  'learn', 'health', 'wealth', 'ventures', 'justice', 'community'
);

create type post_status as enum ('active', 'fulfilled', 'closed', 'draft');

create type reaction_type as enum ('uplift', 'can_help', 'solidarity');

-- Profiles (extends auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  short_bio text,
  role uplift_role not null default 'community_member',
  modules uplift_module[] not null default '{}',
  location_city text,
  location_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Posts (social objects: stories, mutual aid, events)
create table public.posts (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  type post_type not null,
  module uplift_module,
  title text not null,
  body text not null default '',
  tags text[] not null default '{}',
  status post_status not null default 'active',
  location_geohash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Post reactions
create table public.post_reactions (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type reaction_type not null default 'uplift',
  created_at timestamptz not null default now(),
  unique(post_id, user_id)
);

-- Social graph: follows
create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

-- Indexes
create index posts_author_id_idx on public.posts(author_id);
create index posts_type_idx on public.posts(type);
create index posts_module_idx on public.posts(module);
create index posts_status_idx on public.posts(status);
create index posts_created_at_idx on public.posts(created_at desc);
create index post_reactions_post_id_idx on public.post_reactions(post_id);
create index follows_follower_id_idx on public.follows(follower_id);
create index follows_followed_id_idx on public.follows(followed_id);

-- Auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute procedure public.handle_updated_at();

create trigger posts_updated_at before update on public.posts
  for each row execute procedure public.handle_updated_at();

-- Auto-create profile on auth signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'display_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.follows enable row level security;

-- Profiles policies
create policy "Profiles are public" on public.profiles for select using (true);
create policy "Users can update own profile" on public.profiles for update
  using (auth.uid() = id);

-- Posts policies
create policy "Active posts are public" on public.posts for select
  using (status != 'draft' or auth.uid() = author_id);
create policy "Authenticated users can create posts" on public.posts for insert
  with check (auth.uid() = author_id);
create policy "Authors can update own posts" on public.posts for update
  using (auth.uid() = author_id);
create policy "Authors can delete own posts" on public.posts for delete
  using (auth.uid() = author_id);

-- Reactions policies
create policy "Reactions are public" on public.post_reactions for select using (true);
create policy "Authenticated users can react" on public.post_reactions for insert
  with check (auth.uid() = user_id);
create policy "Users can remove own reactions" on public.post_reactions for delete
  using (auth.uid() = user_id);

-- Follows policies
create policy "Follows are public" on public.follows for select using (true);
create policy "Authenticated users can follow" on public.follows for insert
  with check (auth.uid() = follower_id);
create policy "Users can unfollow" on public.follows for delete
  using (auth.uid() = follower_id);
