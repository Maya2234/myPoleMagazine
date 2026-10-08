-- "Delete my account".
-- Run this once in the Supabase SQL editor.
--
-- A browser can never delete a row from auth.users - that needs the service role key, which must
-- never ship in a web app - so this runs server side as a security definer function. It only ever
-- acts on auth.uid(), so a signed-in dancer can delete their own account and nothing else.
--
-- What goes:
--   * their uploads - the files in the media bucket and their rows
--   * their moves (which takes their collection links with them) and their collections
--   * Bible suggestions still waiting for review, and their profile row
-- What stays (the choice made for this project):
--   * approved Bible entries they submitted, because other dancers have linked moves to them.
--     Their submitted_by is cleared so they are no longer attributed to a deleted account.
--
-- If this fails with a foreign key violation, the table it names still references the account
-- without an ON DELETE rule. List the candidates with:
--
--   select conname, conrelid::regclass as tbl, pg_get_constraintdef(oid)
--   from pg_constraint
--   where contype = 'f'
--     and confrelid in ('public.profiles'::regclass, 'auth.users'::regclass);
--
-- then re-add the offender with ON DELETE CASCADE (or SET NULL where the row should outlive the
-- account, as with an approved Bible entry).

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth, storage
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;

  /* Nothing here touches the bucket on purpose. Supabase refuses direct writes to the storage
   * tables - "Direct deletion from storage tables is not allowed. Use the Storage API instead." -
   * because deleting the row alone would leave the object in the bucket. store.js deletes the
   * files through the Storage API before it calls this function, which is the supported order. */

  delete from public.media where owner_id = me;
  delete from public.moves where user_id = me;
  delete from public.categories where user_id = me;
  delete from public.dictionary_entries where submitted_by = me and status <> 'approved';
  /* Approved entries stay behind, unattributed. Skipped when the column is NOT NULL, in which
   * case the foreign key has to decide instead (ON DELETE SET NULL or CASCADE). */
  begin
    update public.dictionary_entries set submitted_by = null where submitted_by = me;
  exception when not_null_violation then
    null;
  end;
  delete from public.profiles where id = me;
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
