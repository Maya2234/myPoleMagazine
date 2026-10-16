-- Also known as: the other names a trick goes by, as a list the members fill in themselves.
--
-- Run this once in the Supabase SQL editor, after the base tables exist. It is written to be safe to
-- run again: nothing already in the database is deleted, renamed or rewritten.
--
-- Why a table of aliases rather than a second name on the trick
--   dictionary_entries.name is the canonical name, and it has to stay that way: it is what a move
--   links to, what the review queue approves, and what every screen shows. A second name stored on
--   that row would immediately raise the question the app has no answer for - which one is real? -
--   and two entries that are one trick would still be two entries.
--
--   An alias is the other half of the same problem, answered honestly: one name wins, and the names
--   dancers actually say out loud are listed underneath it. "The pole sit with your legs crossed" is
--   a name, a nickname and a description all at once, and none of that needs a decision from anybody.
--
-- What this replaces
--   supabase/entry-edits.sql, whose member-facing flow is gone from the app: proposing a rename for
--   every nickname meant an argument and a queue to settle it, when the useful thing was to write the
--   nickname down where a search would find it. That file stays on disk, untouched, because a
--   database that has already run it keeps the table and rows it made; nothing here reads or writes
--   them, and the app no longer offers a way to file one.
--
-- Who can do what
--   * any signed-in dancer may read every alias, and add one to a trick they can see. The list exists
--     to be read by a search box, so hiding it would defeat it, and the members typing the names are
--     the only ones who know them.
--   * the dancer who added one, or an admin, may take it off. A typo should not need an admin, and a
--     list nobody can correct is a list nobody trusts.
--   * nothing renames anything: adding an alias cannot change a trick's name, which is exactly why
--     this is safe to let everybody do freely.


-- 1. the aliases ---------------------------------------------------------------------

create table if not exists public.entry_aliases (
  id uuid primary key default gen_random_uuid(),
  dictionary_entry_id uuid not null references public.dictionary_entries (id) on delete cascade,
  /* The nickname as the member typed it. The app trims it and caps it at 60 before writing, and
   * refuses the trick's own name - the name is not an alias of itself - but the last word is here. */
  alias text not null,
  /* Who wrote it. on delete set null rather than cascade: the nickname stays useful when the account
   * that typed it is closed, because by then it is a fact about the trick and not about them. Null is
   * also what an imported row carries, and the app says so in words rather than showing "unknown". */
  added_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint entry_aliases_alias_sane check (char_length(btrim(alias)) between 2 and 60)
);

/* One row per nickname per trick, ignoring case and surrounding spaces, for the same reason
 * studios.sql has one on a studio's name and city: "Pole sit" and "pole sit " are one name, and a
 * list of near-duplicates is a worse answer than no list.
 *
 * The same nickname may belong to two different tricks, and that is deliberate - "Cupid" really is
 * what two studios call two different things - so the pair is what is unique, not the alias.
 *
 * dictionary_entry_id is the leading column, so the read the app makes - every alias of one trick,
 * and the whole table at start-up - is served by this index, and the foreign key's own check is too.
 * A second index on that column alone would be dead weight. */
create unique index if not exists entry_aliases_entry_alias_key
  on public.entry_aliases (dictionary_entry_id, lower(btrim(alias)));

/* No update grant: a row is added or taken off, never edited. Correcting a nickname means deleting
 * it and adding the right one, which keeps the author's name honest - an edited row would otherwise
 * read as though whoever first typed it had written the second version. */
grant select, insert, delete on public.entry_aliases to authenticated;
alter table public.entry_aliases enable row level security;


-- 2. the rules -----------------------------------------------------------------------

/* Readable by any signed-in dancer who can see the trick it belongs to. An alias is public knowledge
 * about a shared trick, on the same footing as the name it belongs to, and the point of the list is
 * that a search finds a trick by it - so this is as open as the dictionary itself.
 *
 * `using (true)` would be a mistake, though: a nickname filed on somebody else's unreviewed
 * suggestion would leak the fact that the suggestion exists, which is the one thing this project
 * keeps between a member and the reviewers. So the rule names the same three ways of seeing an entry
 * that the entry's own select policy does - approved, mine, or an admin's (see admins.sql). */
drop policy if exists entry_aliases_read on public.entry_aliases;
create policy entry_aliases_read on public.entry_aliases for select to authenticated
  using (
    exists (select 1 from public.dictionary_entries e
             where e.id = dictionary_entry_id
               and (e.status = 'approved' or e.submitted_by = auth.uid() or public.is_admin()))
  );

/* added_by defaults to auth.uid(), so a row always starts out credited to whoever inserted it and
 * cannot be filed on somebody else's behalf.
 *
 * The second half is the rule a nickname would otherwise walk around: an alias may only be attached
 * to a trick this dancer is allowed to see - an approved one, or a pending suggestion of their own.
 * It is the same subquery levels.sql uses for a vote, so a nickname cannot be parked on somebody
 * else's unreviewed suggestion and leak the fact that it exists. */
drop policy if exists entry_aliases_insert on public.entry_aliases;
create policy entry_aliases_insert on public.entry_aliases for insert to authenticated
  with check (
    added_by = auth.uid()
    and exists (select 1 from public.dictionary_entries e
                 where e.id = dictionary_entry_id
                   and (e.status = 'approved' or e.submitted_by = auth.uid()))
  );

-- Yours to take back off.
drop policy if exists entry_aliases_delete_own on public.entry_aliases;
create policy entry_aliases_delete_own on public.entry_aliases for delete to authenticated
  using (added_by = auth.uid());

/* And an admin's, for the nickname somebody added to the wrong trick, or added twice under two
 * spellings - the commonest way a shared list goes wrong is a member who is no longer around to fix
 * it.
 *
 * Postgres ORs permissive policies for the same command together, so this widens delete rather than
 * replacing entry_aliases_delete_own: both are needed, one for each author.
 *
 * As with a studio's Instagram handles, the app asks for the deleted row back rather than trusting an
 * empty response: deleting a row a policy does not match is a success with nothing in it, and a
 * screen that reported that as "removed" would be lying. */
drop policy if exists entry_aliases_delete_admin on public.entry_aliases;
create policy entry_aliases_delete_admin on public.entry_aliases for delete to authenticated
  using (public.is_admin());


-- 3. checking it afterwards -----------------------------------------------------------
-- Every nickname one trick has been given, and who gave it:
--
--   select e.name as trick, a.alias, p.username as added_by, a.created_at
--     from public.entry_aliases a
--     join public.dictionary_entries e on e.id = a.dictionary_entry_id
--     left join public.profiles p on p.id = a.added_by
--    where lower(btrim(e.name)) = lower('Cupid')
--    order by a.created_at;
--
-- The ones whose author has since closed their account (added_by is null), which is how the app ends
-- up saying a member added it rather than naming somebody who is gone:
--
--   select e.name as trick, a.alias
--     from public.entry_aliases a join public.dictionary_entries e on e.id = a.dictionary_entry_id
--    where a.added_by is null
--    order by lower(e.name);
--
-- What the browser may do with the table - select, insert and delete, and no update:
--
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'entry_aliases'
--    order by grantee, privilege_type;
--
-- The four policies this file should have left behind:
--
--   select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'entry_aliases'
--    order by policyname;
--
-- The search that reads this table, as the app does it - finding a trick by a name nobody would have
-- thought to put in the dictionary:
--
--   select e.name, a.alias
--     from public.entry_aliases a join public.dictionary_entries e on e.id = a.dictionary_entry_id
--    where lower(a.alias) like '%' || lower('crossed legs') || '%'
--    order by lower(e.name);
--
-- If the trick page says the aliases are not switched on, this file has not been run. If adding one
-- fails with "duplicate key value violates unique constraint entry_aliases_entry_alias_key" then that
-- nickname is already on that trick - the app checks the list it already has before writing, so this
-- is what a race with another member looks like.
