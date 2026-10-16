-- Home studios, in the order a dancer puts them: several per profile, not one.
--
-- Run this once in the Supabase SQL editor, after supabase/studios.sql has been run - it reads and
-- backfills from the column that file added. It is written to be safe to run again: nothing already
-- in the database is deleted or rewritten.
--
-- studios.sql gave a profile one home studio, which answered "where do you train". Plenty of dancers
-- train in more than one place - a home studio, a second one near work, the one they teach at - and
-- a single column forces them to pick a favourite and throw the rest away. So the claim becomes a
-- row: one row per studio a dancer has added, each with the position they put it in.
--
-- What the app does with the list
--   * a profile shows the top row - the first studio in the dancer's own order - and nothing else
--     until you ask: a "+N" beside it opens the rest. That is why position is stored rather than
--     just a set of studios: the order is a choice, and the choice is displayed.
--   * the editor lists every studio with a way to move it up or down, so the order is the dancer's
--     to set, and saving rewrites the whole list in one go.
--   * the Community page's studio filter matches any of them: a dancer who trains in two places is
--     found under both, which is the point of the table.
--   * a studio's own page lists the members who have added it, which is the query the index on
--     studio_id below serves.
--
-- Who can see what
--   * the list is readable by any signed-in dancer, exactly as studios.sql already exposes which
--     studio a profile trains at: that is the whole reason someone adds theirs.
--   * you may add, reorder and remove your own rows, and nobody else's. There is no admin policy
--     here, deliberately: a studio claim is a fact about one dancer and there is nothing to moderate
--     - adding a studio to the directory is already open to everyone, and taking one off is a
--     deliberate act in the SQL editor.


-- 1. the list ------------------------------------------------------------------------

create table if not exists public.profile_studios (
  /* The dancer whose list this row belongs to. default auth.uid() so a row always starts out
   * credited to whoever inserted it and cannot be inserted on somebody else's behalf - the insert
   * policy below says the same thing out loud. */
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  studio_id uuid not null references public.studios (id) on delete cascade,
  /* Where this studio sits in that dancer's list, smallest first. Not unique: two rows that somehow
   * share a position are still ordered, by added_at, which is why every query in the app orders by
   * both. Rewriting the list on save is what keeps the numbers tidy. */
  position integer not null default 0,
  added_at timestamptz not null default now(),
  /* One claim per dancer per studio: the pair is the row's identity, so the same studio cannot be
   * listed twice and cannot be listed twice with two different positions. */
  primary key (user_id, studio_id),
  constraint profile_studios_position_sane check (position >= 0)
);

/* The studio page asks "who has added this studio", and the Community filter asks the same question
 * from the other end. This is the index that answers it; the primary key already covers the other
 * direction, one dancer's whole list. */
create index if not exists profile_studios_studio_idx on public.profile_studios (studio_id);

/* on delete cascade on both ends, and the two mean different things. Closing an account takes the
 * dancer's claims with it. Removing a studio is a deliberate act in the SQL editor - studios.sql
 * gives nobody a way to do it from the app - and when it happens the claims go too: profile_studios
 * is a join, and a row pointing at a studio that no longer exists has nothing left to say. Note the
 * contrast with profiles.home_studio_id, which was declared on delete set null: as a column it had
 * to survive with the label gone, whereas a join row has no meaning without both ends. */

grant select, insert, update, delete on public.profile_studios to authenticated;
alter table public.profile_studios enable row level security;

drop policy if exists profile_studios_read on public.profile_studios;
create policy profile_studios_read on public.profile_studios for select to authenticated
  using (true);

drop policy if exists profile_studios_insert on public.profile_studios;
create policy profile_studios_insert on public.profile_studios for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists profile_studios_update on public.profile_studios;
create policy profile_studios_update on public.profile_studios for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists profile_studios_delete on public.profile_studios;
create policy profile_studios_delete on public.profile_studios for delete to authenticated
  using (user_id = auth.uid());


-- 2. what everybody already chose ------------------------------------------------------
-- The one studio a dancer had becomes the first row of their list, so nothing anybody picked is lost
-- when the app stops reading the column. on conflict do nothing makes this safe to run again, and
-- safe for a dancer who has since edited their list: an existing row is left exactly as it is,
-- position included.

insert into public.profile_studios (user_id, studio_id, position)
select id, home_studio_id, 0
  from public.profiles
 where home_studio_id is not null
on conflict (user_id, studio_id) do nothing;


-- 3. the old column stays -----------------------------------------------------------------
-- profiles.home_studio_id keeps its value and is not renamed or dropped, exactly as studios.sql left
-- profiles.city when the profile editor stopped editing it: a column that other SQL or a future tool
-- might still read, and dropping a column that holds data is not something a "safe to run again"
-- file should do. From here the app neither reads nor writes it - store.js builds a profile's studios
-- from this table - so the two can disagree, and the last query in section 4 is how you find anyone
-- whose column has fallen behind.
--
-- This file deliberately does NOT touch the profiles column-grant list that admins.sql, studios.sql
-- and instagram.sql each repeat: it adds no column to profiles, so that list is still correct, and
-- rewriting it here would only add a fourth place for it to drift out of step.


-- 4. checking it afterwards --------------------------------------------------------------
-- One dancer's studios, in the order their profile shows them:
--
--   select s.name, s.city, ps.position
--     from public.profile_studios ps join public.studios s on s.id = ps.studio_id
--    where ps.user_id = auth.uid()
--    order by ps.position, ps.added_at;
--
-- How many members each studio has, busiest first - this is the count a studio page shows:
--
--   select s.name, s.city, count(ps.user_id) as members
--     from public.studios s left join public.profile_studios ps on ps.studio_id = s.id
--    group by s.id, s.name, s.city
--    order by members desc, lower(s.name);
--
-- What the browser may do with the table - select, insert, update and delete, and nothing else:
--
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'profile_studios'
--    order by grantee, privilege_type;
--
-- The four policies, which should be the four named above:
--
--   select policyname, cmd from pg_policies where tablename = 'profile_studios' order by policyname;
--
-- Anyone whose profiles.home_studio_id is not also a row here, which means the backfill has not been
-- run since they last saved from the app - re-running this file fixes exactly this:
--
--   select p.username, p.home_studio_id
--     from public.profiles p
--    where p.home_studio_id is not null
--      and not exists (select 1 from public.profile_studios ps
--                       where ps.user_id = p.id and ps.studio_id = p.home_studio_id)
--    order by lower(p.username);
--
-- If the app says studios are not switched on, supabase/studios.sql has not been run: this file
-- builds on it. If a saved list of studios comes back empty while this table has rows, the browser
-- is not reading it - check the read policy above before looking at the app.
