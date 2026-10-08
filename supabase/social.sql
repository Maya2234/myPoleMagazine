-- The social layer: Poler since, avatars, and following.
--
-- Run this once in the Supabase SQL editor, after the base tables exist. It is written to be safe
-- to run again - nothing already in the database is deleted, renamed or rewritten.
--
--   1. two more columns on profiles  (poling_since, avatar)
--   2. the follows table, with the rules that make a follow yours to give and yours to take back


-- 1. profile additions ------------------------------------------------------------

-- The year a dancer started pole. Shown in the app as "Poler since 2021".
-- The column keeps the name poling_since: a column name cannot contain a space, and renaming one
-- that already holds data would mean a migration for no visible gain. The app maps it to the words
-- dancers read, which is where "Poler" lives.
alter table public.profiles add column if not exists poling_since integer;

-- The chosen avatar, or null for the generated letter avatar. It holds one of the preset keys from
-- AVATAR_FILES in store.js; the app only writes those, and anything else (a preset that was
-- removed, or a row edited by hand) falls back to the letter rather than breaking the profile.
alter table public.profiles add column if not exists avatar text;

-- A sanity bound, so a typo cannot store year 99999 and render as nonsense.
alter table public.profiles drop constraint if exists profiles_poling_since_sane;
alter table public.profiles add constraint profiles_poling_since_sane
  check (poling_since is null or (poling_since between 1900 and 2100));


-- 2. following --------------------------------------------------------------------

-- One row per follow. The follower is the person doing the following; deleting either account
-- removes the row, because both ends point at profiles.
create table if not exists public.follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx on public.follows (followee_id);

grant select, insert, delete on public.follows to authenticated;
alter table public.follows enable row level security;

-- Readable by any signed-in dancer, because follower counts are shown on profiles and on the
-- Community page. What is exposed is who follows whom, which is public on every social app;
-- nothing else about either account becomes readable through this, because that is decided by
-- the policies on profiles, moves and media.
drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select to authenticated
  using (true);

-- You can only create a follow as yourself, and only remove your own.
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert to authenticated
  with check (follower_id = auth.uid());

drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete to authenticated
  using (follower_id = auth.uid());

-- Removing a follower: the mirror of the rule above. A dancer may delete a follow that points at
-- them as well as one they made, which is what "Remove" beside a follower on the Account screen
-- does. Postgres ORs permissive policies for the same command together, so this widens delete
-- rather than replacing follows_delete - both are needed, one for each direction.
--
-- Without this, the delete matches no rows and Supabase still answers success - an empty list
-- rather than an error - so on its own the app cannot tell a removal from a policy that quietly
-- refused. store.js therefore asks for the deleted rows back and says so when none come.
drop policy if exists follows_remove_follower on public.follows;
create policy follows_remove_follower on public.follows for delete to authenticated
  using (followee_id = auth.uid());

-- Note: following is one-directional and unlocks nothing. A private account stays private to the
-- people following it - their moves are still hidden by the policies on public.moves. What
-- following does is fill the "People I follow" filter on the Community page.
