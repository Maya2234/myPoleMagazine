-- Current goals: one collection per profile, created with the profile.
--
-- The home screen (#/) is just this collection, so every dancer needs one. Run this once in the
-- Supabase SQL editor. It is safe to run again: everything below is written to be repeatable, and
-- nothing already in the database is deleted or renamed.
--
-- It does four things:
--   1. marks a collection as "the one the home page uses" (categories.is_default),
--   2. keeps that to at most one per dancer,
--   3. gives the profiles that already exist their collection,
--   4. gives every profile created from now on one automatically.


-- 1. The marker. Existing collections keep working: they are simply not the default.
alter table public.categories
  add column if not exists is_default boolean not null default false;

-- 2. At most one default collection per dancer, enforced by the database rather than by the app.
create unique index if not exists categories_one_default_per_user
  on public.categories (user_id)
  where is_default;


-- 3. Backfill. If a dancer already has a collection called "Current goals" it becomes the default
--    one; otherwise they get an empty one.
do $$
declare
  p record;
begin
  for p in select id from public.profiles loop
    if not exists (select 1 from public.categories where user_id = p.id and is_default) then
      update public.categories
         set is_default = true
       where user_id = p.id
         and lower(btrim(name)) = 'current goals';

      if not found then
        insert into public.categories (user_id, name, is_default)
        values (p.id, 'Current goals', true)
        on conflict do nothing;
      end if;
    end if;
  end loop;
end $$;


-- 4. New profiles. The trigger runs as the table owner, so it does not depend on the client's
--    row-level security policies, and it runs no matter how the profile row is created.
create or replace function public.add_current_goals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.categories (user_id, name, is_default)
  values (new.id, 'Current goals', true)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists profiles_current_goals on public.profiles;
create trigger profiles_current_goals
  after insert on public.profiles
  for each row execute function public.add_current_goals();
