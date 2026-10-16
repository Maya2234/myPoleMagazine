-- Where members train: a directory of studios, and a home studio and city on a profile.
--
-- Run this once in the Supabase SQL editor, after the base tables exist. It is written to be safe
-- to run again: nothing already in the database is deleted or renamed.
--
-- The problem this solves is a small one and a real one: two members who train at the same place
-- have no way to find each other in an app that otherwise knows plenty about them. A studio is
-- therefore a row of its own rather than a text box on a profile - "Studio 54" typed forty times is
-- forty different studios, and none of them can answer "who else goes here". The dropdown can only
-- offer what this table holds, and this table can only hold what somebody entered.
--
-- Who can see what
--   * the studio list is a directory, so any signed-in dancer may read all of it. That is the point:
--     a dropdown cannot offer a studio the reader is not allowed to see.
--   * any signed-in dancer may ADD a studio, because the list has to be able to grow from the app
--     itself - the alternative is a list that only ever holds what this file shipped with.
--   * anybody may correct a studio they added themselves. Nobody can delete one from the app: a
--     studio that others have already chosen as their home would leave their profile pointing at
--     nothing, and they would never be told. Removing one is a deliberate act in the SQL editor,
--     where you can see who is attached to it first.
--   * profiles.city and profiles.home_studio_id read like the rest of a profile and are subject to
--     the same row level security. Both are optional: a dancer who does not say is not asked again.
--
-- Both are genuinely optional. Nothing in the app requires a studio or a city, and a profile
-- without either looks exactly like one from before this file was run.


-- 1. the studios -------------------------------------------------------------------

create table if not exists public.studios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  /* Nullable on purpose: plenty of studios are the only one in a small town, and demanding a city
   * to add one would be a reason not to bother. Where there are two with the same name, the city is
   * what tells them apart in the dropdown. */
  city text,
  /* Who added it, so a typo can be fixed by the person who made it. Null when that account is
   * deleted: the studio stays, because other members may have chosen it. */
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint studios_name_not_blank check (char_length(btrim(name)) between 2 and 80),
  constraint studios_city_sane check (city is null or char_length(btrim(city)) between 2 and 80)
);

/* One row per studio, as far as the app is concerned: the same name in the same city, ignoring case
 * and surrounding spaces, is the same studio. Without this the directory fills up with "Studio 54"
 * and "studio 54 " and the dropdown becomes a worse text box than the one it replaced. */
create unique index if not exists studios_name_city_key
  on public.studios (lower(btrim(name)), lower(btrim(coalesce(city, ''))));

grant select, insert, update on public.studios to authenticated;
alter table public.studios enable row level security;

drop policy if exists studios_read on public.studios;
create policy studios_read on public.studios for select to authenticated
  using (true);

/* created_by defaults to auth.uid(), so a row always starts out owned by whoever inserted it and
 * cannot be inserted on somebody else's behalf. */
drop policy if exists studios_insert on public.studios;
create policy studios_insert on public.studios for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists studios_update_own on public.studios;
create policy studios_update_own on public.studios for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());


-- 2. the two columns on a profile ----------------------------------------------------

alter table public.profiles add column if not exists city text;

/* on delete set null rather than cascade: if a studio ever is removed, the members attached to it
 * lose a label, not their account. */
alter table public.profiles add column if not exists home_studio_id uuid
  references public.studios (id) on delete set null;

create index if not exists profiles_home_studio_idx on public.profiles (home_studio_id);

alter table public.profiles drop constraint if exists profiles_city_sane;
alter table public.profiles add constraint profiles_city_sane
  check (city is null or char_length(btrim(city)) <= 80);


-- 3. letting the browser write them --------------------------------------------------
-- READ THIS PART IF A SAVED STUDIO EVER COMES BACK "permission denied for table profiles".
--
-- supabase/admins.sql narrows the browser's update on profiles to a named list of columns, so that
-- a dancer cannot set is_admin on themselves. A column that is not on that list cannot be written
-- from the app at all, however good the row level security is - and the failure looks like a bug in
-- the form, not like a missing grant.
--
-- So the list is repeated here with the two new columns on it. There are now two places that name
-- this list, and they have to agree: if a future file adds another writable column to profiles, add
-- it to both, or the app will be able to save it only until somebody re-runs admins.sql.
--
-- The revoke comes first so this holds whether or not admins.sql has been run: a plain table-wide
-- update grant granted earlier is not undone by a later column grant on top of it.

revoke update on public.profiles from authenticated;
grant update (username, is_private, poling_since, avatar, city, home_studio_id)
  on public.profiles to authenticated;


-- 4. checking it afterwards ----------------------------------------------------------
-- The list the dropdown will offer, in the order it offers it:
--
--   select name, city, created_at from public.studios order by lower(name);
--
-- Who else has picked the same studio as you:
--
--   select p.username, p.city
--     from public.profiles p
--    where p.home_studio_id = (select home_studio_id from public.profiles where id = auth.uid())
--    order by lower(p.username);
--
-- What the browser is allowed to write on profiles - city and home_studio_id must be in this list:
--
--   select column_name from information_schema.column_privileges
--    where table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE'
--    order by column_name;
--
-- If the App says studios are not switched on, this file has not been run. If adding one fails with
-- "duplicate key value violates unique constraint studios_name_city_key" then that studio is already
-- in the list under the same name and city, and the app should have offered it.
