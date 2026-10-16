-- Proposed changes to a trick in the pole dictionary, and the review that decides them.
--
-- Run this once in the Supabase SQL editor, after the base tables exist. It is written to be safe to
-- run again: nothing already in the database is deleted or renamed.
--
-- What it adds
--   * entry_edits - one row per proposed change to a dictionary_entries row
--   * the trigger that makes a proposal pending whoever sends it
--   * the policies that keep a pending proposal between its author and the admins
--
-- Why a table of proposals rather than letting a member edit the entry
--   The dictionary is the shared name for a trick: other members have already linked their own moves to
--   it, and the whole point of the table is that one name wins. Letting any signed-in dancer rewrite
--   that name would mean the community's answer could be changed by whoever typed first, with no
--   record of what it used to be. A proposal is the same shape review already has for a brand new
--   trick, so there is one place a decision is made and one place to look for who made it.
--
-- What a proposal holds
--   * proposed_name - the name as it should read, a snapshot rather than a link, so a proposal means
--     the same thing later even if the entry has been renamed in the meantime
--   * note - why, in the member's own words; optional, because "you spelled it wrong" is sometimes
--     the whole of it
--
-- What approval does
--   The name is written onto dictionary_entries and the proposal is marked approved. The rename is a
--   normal update on that table, so it needs the admin update policy in supabase/admins.sql; until
--   that file has been run, the review queue is not reachable by anybody anyway.
--
-- Rejecting keeps the row (status 'rejected') rather than deleting it, which is the opposite of what
-- happens to a rejected *trick*. A rejected trick is a row that never belonged in the dictionary; a
-- rejected name is the answer to a question a member asked about a trick that does belong, and it
-- exists so the app can tell them the answer instead of leaving their suggestion to vanish.


-- 1. the proposals -------------------------------------------------------------------

create table if not exists public.entry_edits (
  id uuid primary key default gen_random_uuid(),
  dictionary_entry_id uuid not null references public.dictionary_entries (id) on delete cascade,
  /* Defaulted to the caller, and pinned to the caller by the trigger below: a proposal cannot be
   * filed in another member's name. */
  submitted_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  /* The longest name the app accepts is 60 characters (submitEntry in store.js); the bounds are
   * repeated here so a row edited by hand cannot break a screen that has to draw it. */
  proposed_name text not null check (length(btrim(proposed_name)) between 1 and 60),
  note text check (note is null or length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null
);

create index if not exists entry_edits_entry_idx on public.entry_edits (dictionary_entry_id);
create index if not exists entry_edits_author_idx on public.entry_edits (submitted_by);
/* The review queue only ever asks for pending rows, which is the one query that runs on every page
 * load of it; a partial index keeps the rejected history out of the way of that lookup. */
create index if not exists entry_edits_pending_idx on public.entry_edits (created_at) where status = 'pending';

grant select, insert, update, delete on public.entry_edits to authenticated;
alter table public.entry_edits enable row level security;


-- 2. the rules -----------------------------------------------------------------------
--
-- Read: mine, and - for an admin - everything. A pending proposal is as private as a pending trick:
-- telling the whole community that somebody wants a trick renamed would turn a question into an
-- argument before anyone had decided it.
--
-- Insert: only as myself, and only ever pending. The trigger below is what makes the second half
-- true regardless of what the client sends, the same way force_entry_status does for a new trick
-- (see supabase/admins.sql). A policy is the wrong tool for it on its own: a policy can refuse a
-- row, but it cannot quietly correct one.
--
-- Update: an admin, and nobody else - this is the review. A member does not get to approve their own
-- suggestion, or to edit it after it is filed; they withdraw it and file again, which leaves the
-- record honest.
--
-- Delete: the author withdrawing a proposal that has not been decided, or an admin clearing one out.

drop policy if exists entry_edits_read on public.entry_edits;
create policy entry_edits_read on public.entry_edits for select to authenticated
  using (submitted_by = auth.uid() or public.is_admin());

drop policy if exists entry_edits_insert on public.entry_edits;
create policy entry_edits_insert on public.entry_edits for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and status = 'pending'
    and exists (select 1 from public.dictionary_entries e
                 where e.id = dictionary_entry_id and e.status = 'approved')
  );

drop policy if exists entry_edits_admin_update on public.entry_edits;
create policy entry_edits_admin_update on public.entry_edits for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists entry_edits_withdraw on public.entry_edits;
create policy entry_edits_withdraw on public.entry_edits for delete to authenticated
  using ((submitted_by = auth.uid() and status = 'pending') or public.is_admin());


-- 3. a proposal is always pending, and always mine ------------------------------------

create or replace function public.force_entry_edit_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  /* Anyone signed in files a proposal: pending, in their own name, not yet reviewed. Admins publish
   * by reviewing, exactly as they do for a new trick, so there is one way in and one decision. From
   * the SQL editor, or any script holding the service role key, there is no signed-in dancer, so a
   * row seeded by hand - an import, or a fix for one member - still says what it says. */
  if auth.uid() is not null then
    new.status := 'pending';
    new.submitted_by := auth.uid();
    new.reviewed_at := null;
    new.reviewed_by := null;
  end if;
  return new;
end $$;

drop trigger if exists entry_edits_force_pending on public.entry_edits;
create trigger entry_edits_force_pending
  before insert on public.entry_edits
  for each row execute function public.force_entry_edit_pending();


-- 4. what the app does with it --------------------------------------------------------
-- For reference; nothing here is run by the app.
--
--   filing a proposal        insert into entry_edits (dictionary_entry_id, proposed_name, note)
--                            values (..., ..., ...)          -- submitted_by and status are forced
--
--   the author's own view    select * from entry_edits
--                             where dictionary_entry_id = ... order by created_at desc
--                            -- their pending one and their past rejected ones; an admin gets
--                            -- everybody's, which is how the trick page can say "waiting for review"
--
--   the queue                select * from entry_edits where status = 'pending' order by created_at
--
--   approving                update dictionary_entries set name = <proposed_name> where id = <entry>
--                            update entry_edits set status = 'approved', reviewed_at = now(),
--                                   reviewed_by = auth.uid() where id = <the proposal>
--                            -- in that order, and in store.js it is: if the new name is already
--                            -- taken the rename fails and the proposal stays pending, which is the
--                            -- state an admin needs to see it in. Marking it approved first would
--                            -- swallow the failure and leave the queue empty and the trick unchanged.
--
--   withdrawing              delete from entry_edits where id = <the proposal>


-- 5. checking it afterwards -----------------------------------------------------------
-- Who has proposed what, and what was decided. As an admin this is the whole history; as anybody
-- else it is your own, which is the honest way to see the policies working:
--
--   select e.name as trick, x.proposed_name, x.status, x.created_at,
--          x.reviewed_at, p.username as filed_by
--     from public.entry_edits x
--     join public.dictionary_entries e on e.id = x.dictionary_entry_id
--     left join public.profiles p on p.id = x.submitted_by
--    order by x.created_at desc;
--
-- The policies this file should have left behind - four commands on one table:
--
--   select policyname, cmd, qual, with_check
--     from pg_policies
--    where schemaname = 'public' and tablename = 'entry_edits'
--    order by cmd;
--
-- The trigger that stops a client filing its own decision:
--
--   select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where c.relname = 'entry_edits' and not t.tgisinternal;
--
-- Two things to try by hand in a transaction you roll back, which is what supabase/security-check.sql
-- would do for you if this path were added to it. Both should change nothing, for a dancer:
--
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<a dancer''s uuid>","role":"authenticated"}';
--     update public.entry_edits set status = 'approved' where status = 'pending';   -- 0 rows
--     insert into public.entry_edits (dictionary_entry_id, proposed_name, status)
--       values ('<an entry>', 'Anything', 'approved');                              -- lands pending
--   rollback;
--
-- If approving throws "permission denied for table dictionary_entries" the table grant itself is
-- missing - that is the README's step 2, not this file. If a rename is refused with "could not find
-- the function public.is_admin()", supabase/admins.sql has not been run.
