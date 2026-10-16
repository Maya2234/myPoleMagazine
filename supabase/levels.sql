-- Community difficulty: what members think of a trick, and how that adds up.
--
-- Run this once in the Supabase SQL editor, after the base tables exist. It is written to be safe to
-- run again: nothing already in the database is deleted or renamed.
--
-- A dancer marks a trick beginner, intermediate or advanced. One row per dancer per trick, so
-- changing your mind edits that row rather than adding another, and a trick's level is simply how
-- many members said each thing. Nothing is stored on dictionary_entries: an average kept in a column
-- would need every write kept in step with it, and the counts are the honest form of the same answer.
--
-- Who can see what
--   * a dancer may read their OWN vote, and nobody else's. The three columns are per-person opinions
--     - "an advanced dancer thinks this is beginner" is not something this app should hand out - so
--     the per-person rows are private even though the totals are public.
--   * the totals come from entry_level_totals() below, which counts everyone's rows on the caller's
--     behalf and returns only numbers, plus a flag saying whether one of those votes was theirs.
--
-- This is separate from moves.difficulty, which is one dancer's own 1-5 rating of their own move.
-- That number is theirs; this one belongs to the community.


-- 1. the votes ---------------------------------------------------------------------

create table if not exists public.entry_levels (
  dictionary_entry_id uuid not null references public.dictionary_entries (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  updated_at timestamptz not null default now(),
  /* One vote per dancer per trick. This is also what makes the app's upsert an edit rather than
   * a second row. */
  primary key (dictionary_entry_id, user_id)
);

create index if not exists entry_levels_entry_idx on public.entry_levels (dictionary_entry_id);
create index if not exists entry_levels_user_idx on public.entry_levels (user_id);

grant select, insert, update, delete on public.entry_levels to authenticated;
alter table public.entry_levels enable row level security;

-- Mine to read, mine to write, and only mine in both directions.
drop policy if exists entry_levels_read_own on public.entry_levels;
create policy entry_levels_read_own on public.entry_levels for select to authenticated
  using (user_id = auth.uid());

/* A vote only makes sense on a trick this dancer is allowed to see: an approved one, or a pending
 * suggestion of their own. The subquery is the same rule the entry's own select policy applies, so a
 * vote cannot be parked on somebody else's unreviewed suggestion. */
drop policy if exists entry_levels_insert on public.entry_levels;
create policy entry_levels_insert on public.entry_levels for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.dictionary_entries e
                 where e.id = dictionary_entry_id
                   and (e.status = 'approved' or e.submitted_by = auth.uid()))
  );

drop policy if exists entry_levels_update on public.entry_levels;
create policy entry_levels_update on public.entry_levels for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists entry_levels_delete on public.entry_levels;
create policy entry_levels_delete on public.entry_levels for delete to authenticated
  using (user_id = auth.uid());


-- 2. the totals --------------------------------------------------------------------
-- security definer, because it counts rows the caller may not read - that is the whole point of it.
-- It returns numbers and a flag, never an identity: which dancer chose what stays where it is.
--
-- Rows are only counted for tricks the caller could open, which keeps the "pending suggestions are
-- between you and the reviewers" rule intact even for the counts.
--
-- mine is true only on the row for the level this dancer voted for, which is how the radio group on
-- the trick page knows which pill to light up without a second query.

create or replace function public.entry_level_totals()
returns table (entry_id uuid, level text, votes bigint, mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select l.dictionary_entry_id,
         l.level,
         count(*)::bigint as votes,
         bool_or(l.user_id = auth.uid()) as mine
    from public.entry_levels l
   where exists (select 1 from public.dictionary_entries e
                  where e.id = l.dictionary_entry_id
                    and (e.status = 'approved' or e.submitted_by = auth.uid()))
   group by l.dictionary_entry_id, l.level;
$$;

revoke all on function public.entry_level_totals() from public;
grant execute on function public.entry_level_totals() to authenticated;


-- 3. checking it afterwards ---------------------------------------------------------
-- What everybody thinks of one trick, counted the way the app sees it:
--
--   select entry_id, level, votes, mine from public.entry_level_totals()
--    where entry_id = (select id from public.dictionary_entries where lower(name) = lower('Fireman spin'));
--
-- Your own votes, which is all the API will show you of anyone's:
--
--   select e.name, l.level, l.updated_at
--     from public.entry_levels l join public.dictionary_entries e on e.id = l.dictionary_entry_id
--    where l.user_id = auth.uid() order by l.updated_at desc;
--
-- If the trick page says the levels are not switched on, this file has not been run; if marking a
-- level fails with "permission denied for table entry_levels" the table grant itself is missing,
-- which is the README's step 2 rather than this file.
