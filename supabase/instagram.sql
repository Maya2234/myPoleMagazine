-- Instagram: an optional handle on a profile, and the handles a studio's members have added.
--
-- Run this once in the Supabase SQL editor, after the base tables exist. It is written to be safe to
-- run again: nothing already in the database is deleted, renamed or rewritten.
--
--   1. profiles.instagram - one optional handle, in one column on the profile
--   2. studio_instagrams  - the accounts a studio's members have contributed, as a list
--
-- Why a column for a dancer and a table for a studio
--   * a dancer has one Instagram, so a column says it once and there is nothing to keep in step. It
--     is optional, and it is readable by exactly whoever may read the rest of the profile row.
--   * a studio usually has several: the studio's own account, an account per instructor who teaches
--     there, a second one a member remembers nobody has listed. That is a list rather than a field,
--     it has to be able to grow from the app, and each row records who added it - which is what lets
--     the person who made a typo take it back off without an admin.
--
-- Only the handle is stored, never the address: https://instagram.com/<handle> is the whole of a
-- profile's URL, so building it is a job for the app. A stored URL would instead be the same address
-- in as many spellings as there are members typing it - with or without www., with or without a
-- trailing slash, http or https - and every one of them a different string to compare against.
--
-- The handle keeps Instagram's own shape: up to 30 characters from letters, numbers, full stops and
-- underscores. The @ that people say out loud and the address they paste are both stripped by the
-- app before the row is written (see readInstagram in js/store.js), so the database holds one form.


-- 1. the handle on a profile --------------------------------------------------------

alter table public.profiles add column if not exists instagram text;

/* Instagram's own limit, so a typo cannot store something no account could ever have - and so a
 * handle copied out of the app is one you can paste into Instagram as it stands. Null is the
 * ordinary state: most dancers will not have one, and nothing asks twice. */
alter table public.profiles drop constraint if exists profiles_instagram_sane;
alter table public.profiles add constraint profiles_instagram_sane
  check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$');


-- 2. the handles on a studio ---------------------------------------------------------

create table if not exists public.studio_instagrams (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios (id) on delete cascade,
  handle text not null,
  /* Who added it. on delete set null rather than cascade: a handle the members contributed stays
   * when the account that typed it is closed, because it is a fact about the studio by then and not
   * about them. Null is also what an imported row would carry. */
  added_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint studio_instagrams_handle_sane check (handle ~ '^[A-Za-z0-9._]{1,30}$')
);

/* One row per account per studio, ignoring case and surrounding spaces, for the same reason
 * studios.sql has one on a studio's name and city: "Polehouse" and "polehouse " are one account, and
 * a list of near-duplicates is a worse answer than no list. A studio may be listed twice under
 * different handles - that is the point of the table - so the pair is what is unique, not the handle.
 *
 * studio_id is the leading column of this index, so the query the studio page makes - every handle
 * for one studio - is served by it. No second index on studio_id alone is needed. */
create unique index if not exists studio_instagrams_studio_handle_key
  on public.studio_instagrams (studio_id, lower(btrim(handle)));

/* No update grant: a row is added or taken off, never edited. Correcting a handle means deleting it
 * and adding the right one, which is both simpler to reason about and honest about what happened -
 * the row would otherwise change hands while keeping the original author's name on it. */
grant select, insert, delete on public.studio_instagrams to authenticated;
alter table public.studio_instagrams enable row level security;

-- Readable by any signed-in dancer: the handles sit on the studio's own page, and a studio page is a
-- directory entry, like the studio list itself. What is exposed is a public Instagram account plus
-- the username of whoever contributed it - nothing about a profile, a move or a file becomes
-- readable through this, because those are decided by their own policies.
drop policy if exists studio_instagrams_read on public.studio_instagrams;
create policy studio_instagrams_read on public.studio_instagrams for select to authenticated
  using (true);

/* added_by defaults to auth.uid(), so a row always starts out credited to whoever inserted it and
 * cannot be added on somebody else's behalf. */
drop policy if exists studio_instagrams_insert on public.studio_instagrams;
create policy studio_instagrams_insert on public.studio_instagrams for insert to authenticated
  with check (added_by = auth.uid());

-- Yours to take back off.
drop policy if exists studio_instagrams_delete_own on public.studio_instagrams;
create policy studio_instagrams_delete_own on public.studio_instagrams for delete to authenticated
  using (added_by = auth.uid());

/* And an admin's, for the studio account somebody added a second time or under the wrong name - the
 * commonest way a shared list goes wrong is a member who is no longer around to fix it.
 *
 * Postgres ORs permissive policies for the same command together, so this widens delete rather than
 * replacing studio_instagrams_delete_own: both are needed, one for each author.
 *
 * The app asks for the deleted row back rather than trusting the empty response, the way it does for
 * a follow (see store.js): deleting a row a policy does not match is a success with nothing in it,
 * and a screen that reported that as "removed" would be lying. */
drop policy if exists studio_instagrams_delete_admin on public.studio_instagrams;
create policy studio_instagrams_delete_admin on public.studio_instagrams for delete to authenticated
  using (public.is_admin());


-- 3. letting the browser write the new profile column ---------------------------------
-- READ THIS PART IF A SAVED INSTAGRAM COMES BACK "permission denied for table profiles".
--
-- supabase/admins.sql narrows the browser's update on profiles to a named list of columns, so that
-- a dancer cannot set is_admin on themselves. A column that is not on that list cannot be written
-- from the app at all, however good the row level security is - and the failure looks like a bug in
-- the form rather than like a missing grant.
--
-- So the list is repeated here with instagram on it, exactly as studios.sql repeats it. There are
-- now three places that name this list - admins.sql, studios.sql and this file - and they have to
-- agree: if a future file adds another writable column to profiles, add it to all of them, or the
-- app will be able to save it only until somebody re-runs one of the others.
--
-- The revoke comes first so this holds whether or not admins.sql has been run: a plain table-wide
-- update grant granted earlier is not undone by a later column grant on top of it.

revoke update on public.profiles from authenticated;
grant update (username, is_private, poling_since, avatar, city, home_studio_id, instagram)
  on public.profiles to authenticated;


-- 4. checking it afterwards -----------------------------------------------------------
-- Your own handle, as stored - one line, no @, no address:
--
--   select username, instagram from public.profiles order by lower(username);
--
-- Every handle one studio has been given, and who gave it:
--
--   select s.name, i.handle, p.username as added_by, i.created_at
--     from public.studio_instagrams i
--     join public.studios s on s.id = i.studio_id
--     left join public.profiles p on p.id = i.added_by
--    where lower(btrim(s.name)) = lower('Pole House')
--    order by i.created_at;
--
-- What the browser is allowed to write on profiles - instagram must be in this list:
--
--   select column_name from information_schema.column_privileges
--    where table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE'
--    order by column_name;
--
-- The policies guarding the list, which should be four:
--
--   select policyname, cmd from pg_policies where tablename = 'studio_instagrams' order by policyname;
--
-- If the app says the Instagrams are not switched on, this file has not been run. If adding one
-- fails with "duplicate key value violates unique constraint studio_instagrams_studio_handle_key"
-- then that account is already listed for that studio - the app checks the list it has before
-- writing, so this is what a race with another member looks like.
