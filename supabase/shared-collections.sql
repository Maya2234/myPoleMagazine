-- Shared collections: a collection one dancer can invite another one into.
--
-- Run this once in the Supabase SQL editor, after current-goals.sql. It is written to be safe to run
-- again - nothing already in the database is deleted, renamed or rewritten, and every collection that
-- exists today stays exactly as private as it was.
--
--   1. categories.is_shared - true on a collection its owner has opened to invitations
--   2. category_members - who has accepted an invitation to one
--   3. category_invites - the owner invites a dancer by username, who accepts or declines
--   4. removal - the owner takes a member out, and that dancer's moves come off the list
--   5. reading: a member may see the collection and who else is in it, and so may a dancer with an
--      invitation to it that they have not answered yet
--   6. move_categories - a member may put their own move into a collection they belong to
--   7. stopping - a collection that stops being shared keeps no members and no invitations
--   8. the code, retired - joining by code is gone
--
-- A collection is shared by naming the dancer you are sharing it with. There is no code to pass
-- around and nothing to type: the owner invites, the dancer answers, and the membership is written
-- by the answer. A `share_code` column from the older version of this file is left where it is and
-- is not read by anything here - nothing in the database is deleted - and any collection that had a
-- code is marked shared below, so a class that was joined with one keeps its members.
--
-- What sharing does not do: it does not make anybody's moves public. The moves a shared collection
-- gathers are still read through the policies on public.moves, so a dancer with a private account
-- shows up in the collection only to people who could already see their moves. The collection is
-- shared; the moves in it keep the rules they had.

-- 1. The marker ----------------------------------------------------------------------

-- False on every collection that exists today, which is what "personal" means here. A collection
-- whose owner has invited somebody is the only kind that can be shared: there is no code that could
-- be found, guessed or forwarded.
alter table public.categories add column if not exists is_shared boolean not null default false;

-- One migration, for a project that ran the older version of this file: a collection that was
-- shared by code was a collection with a code, so it becomes a shared collection. The column is
-- looked for before it is used, because a project that never had codes does not have it - and the
-- statement inside `execute` is not planned until it runs, so the older database gets no error.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'categories'
       and column_name = 'share_code'
  ) then
    execute 'update public.categories set is_shared = true where share_code is not null and not is_shared';
  end if;
end $$;

-- The app asks this about every collection it lists, so it should not cost a scan.
create index if not exists categories_shared_idx
  on public.categories (is_shared)
  where is_shared;


-- 2. Membership ---------------------------------------------------------------------

-- One row per member. The owner is not in this table: the owner is categories.user_id, and a row here
-- would have to be kept in step with it - renamed, deleted and backfilled - for nothing.
create table if not exists public.category_members (
  category_id uuid not null references public.categories (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (category_id, user_id)
);

-- The app asks "which collections have I joined" as often as it asks "who is in this one".
create index if not exists category_members_user_idx on public.category_members (user_id);

grant select, insert, delete on public.category_members to authenticated;
alter table public.category_members enable row level security;

-- The two questions the policies in this file have to ask, asked in functions rather than in the
-- policies themselves.
--
-- A policy on category_members that looks at categories, next to a policy on categories that looks
-- at category_members, is a loop: Postgres follows each subquery through the other table's policies,
-- meets the policy it started from, and refuses every query on either table with
-- "infinite recursion detected in policy for relation ...". The same thing happens when a policy on
-- category_members looks at category_members. A security-definer function ends the loop, because
-- inside it the caller's policies do not apply at all - it runs as the table owner, which is how
-- respond_to_collection_invite() below is allowed to do its job too. Each one answers only about the
-- caller's own membership or ownership, so calling it cannot reveal anybody else's.
create or replace function public.is_collection_member(p_category uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.category_members m
     where m.category_id = p_category and m.user_id = auth.uid()
  );
$$;

create or replace function public.owns_collection(p_category uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.categories c
     where c.id = p_category and c.user_id = auth.uid()
  );
$$;

grant execute on function public.is_collection_member(uuid) to authenticated;
grant execute on function public.owns_collection(uuid) to authenticated;

-- Who is in a collection is shown on its page, to the people in it - and to the owner, who may not
-- have joined their own. Both checks go through the functions above, so this policy never reads
-- another table with policies of its own.
drop policy if exists category_members_read on public.category_members;
create policy category_members_read on public.category_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_collection_member(category_id)
    or public.owns_collection(category_id)
  );

-- There is no insert policy on purpose. Joining happens in respond_to_collection_invite() in
-- section 3, which is the only thing that answers "was this dancer invited?"; an insert the client
-- writes itself would let anybody into any collection whose id they can name.

-- Leaving is deleting your own row. Reading it back is what tells the app the row was really there:
-- a delete that matches no policy still reports success, and an empty list is the only evidence.
drop policy if exists category_members_leave on public.category_members;
create policy category_members_leave on public.category_members for delete to authenticated
  using (user_id = auth.uid());


-- 3. Invitations --------------------------------------------------------------------

-- The way into a collection. An invitation names one dancer and waits for that dancer's answer:
-- `status` carries the answer, and a declined invitation stays as the record of it rather than being
-- deleted, so the owner is not silently re-offering it on the next screen they open.
create table if not exists public.category_invites (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  invited_user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint category_invites_once unique (category_id, invited_user_id)
);

-- The question asked most often is "what is waiting for me", so that is the index: invitations are
-- read by the dancer they are for, not by the collection they point at.
create index if not exists category_invites_invitee_idx
  on public.category_invites (invited_user_id, status);

grant select, delete on public.category_invites to authenticated;
alter table public.category_invites enable row level security;

-- An invitation is visible to the dancer it is for and to the owner of the collection. Both checks
-- go through owns_collection(), which is security definer, so this policy never reads categories
-- through categories' own policies - the loop section 2 explains.
drop policy if exists category_invites_read on public.category_invites;
create policy category_invites_read on public.category_invites for select to authenticated
  using (
    invited_user_id = auth.uid()
    or public.owns_collection(category_id)
  );

-- An invitation goes away two ways: the owner withdraws one nobody has answered, and the invited
-- dancer clears one they have answered from their own screen. Answering is not a delete - the row
-- keeps what was answered.
drop policy if exists category_invites_delete on public.category_invites;
create policy category_invites_delete on public.category_invites for delete to authenticated
  using (
    invited_user_id = auth.uid()
    or public.owns_collection(category_id)
  );

-- There is no insert and no update policy on purpose, the same way category_members has no insert
-- policy. An invitation names somebody else and may only be sent by the owner of a collection they
-- have opened to invitations; invite_to_collection() is the one place that checks all of it.
-- Answering is likewise respond_to_collection_invite()'s job, because accepting has to write the
-- membership row that section 2 refuses to clients.
create or replace function public.invite_to_collection(p_category uuid, p_username text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  owner_id uuid;
  open_to_invites boolean;
  invited uuid;
  invited_name text;
  invite_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to invite somebody.';
  end if;

  select c.id, c.user_id, c.is_shared into target, owner_id, open_to_invites
    from public.categories c where c.id = p_category;

  if target is null then
    raise exception 'That collection does not exist.';
  end if;
  if owner_id <> auth.uid() then
    raise exception 'Only the dancer who made a collection can invite to it.';
  end if;
  if not coalesce(open_to_invites, false) then
    raise exception 'Open the collection to invitations before inviting anybody to it.';
  end if;

  -- Type-ahead and the invite box both accept "@name": the @ is how a username is written, not part
  -- of it.
  select p.id, p.username into invited, invited_name
    from public.profiles p
   where lower(p.username) = lower(btrim(ltrim(coalesce(p_username, ''), '@')));

  if invited is null then
    raise exception 'No dancer has that username.';
  end if;
  if invited = auth.uid() then
    raise exception 'That is your own collection.';
  end if;

  if exists (select 1 from public.category_members m
              where m.category_id = target and m.user_id = invited) then
    raise exception '% is already in this collection.', invited_name;
  end if;

  -- Inviting twice is the same invitation rather than an error: one already waiting is still
  -- waiting, and one that was declined and thought better of comes back to pending.
  insert into public.category_invites (category_id, invited_user_id, invited_by)
  values (target, invited, auth.uid())
  on conflict (category_id, invited_user_id) do update
    set status = 'pending', invited_by = auth.uid(), created_at = now(), responded_at = null
  returning id into invite_id;

  return invite_id;
end $$;

grant execute on function public.invite_to_collection(uuid, text) to authenticated;

-- Answering: only the dancer named on the invitation, only while it is pending, and only into a
-- collection that is still open to invitations - an invitation is not a way into a collection whose
-- owner has stopped sharing it. Accepting writes the membership row the client cannot write itself.
create or replace function public.respond_to_collection_invite(p_invite uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.category_invites%rowtype;
  still_shared boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to answer an invitation.';
  end if;

  select * into invite from public.category_invites i
   where i.id = p_invite and i.invited_user_id = auth.uid()
   for update;

  if invite.id is null then
    raise exception 'That invitation is not yours, or it is no longer there.';
  end if;
  if invite.status <> 'pending' then
    raise exception 'That invitation has already been answered.';
  end if;

  select c.is_shared into still_shared
    from public.categories c where c.id = invite.category_id;

  if coalesce(p_accept, false) and not coalesce(still_shared, false) then
    raise exception 'That collection is no longer shared.';
  end if;

  if coalesce(p_accept, false) then
    insert into public.category_members (category_id, user_id)
    values (invite.category_id, auth.uid())
    on conflict do nothing;
  end if;

  update public.category_invites
     set status = case when coalesce(p_accept, false) then 'accepted' else 'declined' end,
         responded_at = now()
   where id = invite.id;

  return invite.category_id;
end $$;

grant execute on function public.respond_to_collection_invite(uuid, boolean) to authenticated;


-- 4. Removing a member --------------------------------------------------------------

-- The owner may take somebody out, not only the member choosing to leave. It is the same outcome as
-- leaving - their moves come off this one list with them, and nothing else of theirs is touched - but
-- the client may only delete its own membership row and its own links, so both deletes happen here.
-- The function checks ownership itself; it does not rely on a policy, because a security-definer
-- function runs outside them.
create or replace function public.remove_collection_member(p_category uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
  present boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to remove a dancer.';
  end if;

  select c.user_id into owner_id from public.categories c where c.id = p_category;
  if owner_id is null then
    raise exception 'That collection does not exist.';
  end if;
  if owner_id <> auth.uid() then
    raise exception 'Only the dancer who made a collection can remove somebody from it.';
  end if;
  if p_user = auth.uid() then
    raise exception 'Use Leave collection to take yourself out.';
  end if;

  select exists (select 1 from public.category_members m
                  where m.category_id = p_category and m.user_id = p_user)
    into present;
  if not present then
    raise exception 'That dancer is not in this collection.';
  end if;

  delete from public.move_categories mc
   using public.moves m
   where mc.move_id = m.id
     and mc.category_id = p_category
     and m.user_id = p_user;

  delete from public.category_members
   where category_id = p_category and user_id = p_user;
end $$;

grant execute on function public.remove_collection_member(uuid, uuid) to authenticated;


-- 5. Reading ------------------------------------------------------------------------

-- An invitation has to say which collection it is about, and the dancer reading it is not a member
-- yet - that is the whole point of the question. Without this the invitation row is readable and the
-- collection it embeds is not, so the screen that lists invitations has a row with no name on it.
-- A security-definer function again, for the reason section 2 gives, and it answers only about the
-- caller's own invitations.
create or replace function public.has_pending_invite(p_category uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.category_invites i
     where i.category_id = p_category
       and i.invited_user_id = auth.uid()
       and i.status = 'pending'
  );
$$;

grant execute on function public.has_pending_invite(uuid) to authenticated;

-- Postgres ORs permissive policies for the same command, so this widens select on categories to
-- include the ones a dancer has joined - and the ones they have been invited to and not answered -
-- and changes nothing about the ones they own, whose rules are still the ones that answer.
drop policy if exists categories_member_read on public.categories;
create policy categories_member_read on public.categories for select to authenticated
  using (
    public.is_collection_member(categories.id)
    or public.has_pending_invite(categories.id)
  );

-- Only the owner may rename a shared collection or delete it: this file adds no update or delete
-- policy on categories, so the owner's existing ones are the only ones there are.


-- 6. Moves in a shared collection ----------------------------------------------------

-- A member may put their own move into a collection they belong to. The move still has to be theirs;
-- this adds a second permissive policy rather than replacing the existing one, so an insert that
-- already passed is unaffected.
drop policy if exists move_categories_member_insert on public.move_categories;
create policy move_categories_member_insert on public.move_categories for insert to authenticated
  with check (
    exists (select 1 from public.moves m
             where m.id = move_id and m.user_id = auth.uid())
    and public.is_collection_member(category_id)
  );

-- Reading those links is what lets a shared collection's page list everybody's moves. What comes
-- back is a link plus whatever the policies on public.moves allow this dancer to see of the move
-- itself - a private account's move is filtered out of the answer, exactly as it is everywhere else.
drop policy if exists move_categories_member_read on public.move_categories;
create policy move_categories_member_read on public.move_categories for select to authenticated
  using (
    public.is_collection_member(move_categories.category_id)
    -- and the owner, who is not a member of their own collection and still has to see all of it
    or public.owns_collection(move_categories.category_id)
  );


-- 7. Stopping -----------------------------------------------------------------------

-- A collection that stops being shared keeps no members and no unanswered invitations. Without
-- this the rows would go on letting everybody who ever accepted read it and add to it, with nothing
-- left to explain why - the delete is in a trigger because the rows belong to other dancers, and
-- only the owner may stop sharing.
create or replace function public.clear_collection_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_shared = false and old.is_shared = true then
    delete from public.category_members where category_id = new.id;
    delete from public.category_invites where category_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists categories_share_cleared on public.categories;
create trigger categories_share_cleared
  after update of is_shared on public.categories
  for each row execute function public.clear_collection_members();


-- 8. The code, retired --------------------------------------------------------------

-- Joining with a code is gone. The function that answered one is dropped, so a collection cannot be
-- entered without the owner inviting the dancer who enters it - the app stops offering the box, and
-- an old cached copy of the app gets an error instead of a way in.
--
-- `share_code` itself is left on any project that had it, and read by nothing here. Deleting a
-- column deletes the codes people were given, and the point of this file is that running it takes
-- nothing away.
drop function if exists public.join_shared_collection(text);


-- Done. Check it worked: a shared collection is a row with is_shared, and its members are rows in
-- category_members. New collections are created with is_shared already true, because the Dancers
-- panel is the only sharing control the app shows. This lists both, read-only:
--
--   select c.name, c.is_shared, count(cm.user_id) as members
--     from public.categories c
--     left join public.category_members cm on cm.category_id = c.id
--    where c.is_shared
--    group by c.id
--    order by c.created_at;
