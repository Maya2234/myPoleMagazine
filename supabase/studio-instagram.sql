-- One Instagram account per studio, and any signed-in dancer may set it.
--
-- Run this once in the Supabase SQL editor, after studios.sql. It is written to be safe to run again:
-- nothing already in the database is deleted, renamed or rewritten except the empty instagram column
-- being filled from the older contributed list.
--
-- Why this replaces the studio_instagrams list
--   * The studio page now shows one account, or a + when there is none. That is a field, not a list,
--     and a field cannot get into the state where three members have added three spellings of the
--     same account.
--   * The old table recorded who contributed each handle and let only that member take it off. A
--     studio's Instagram is a fact about the studio, not about the member who typed it, so anyone
--     who can see the studio page may correct it.
--   * studio_instagrams is left alone. Its rows are history, and a migration that drops data is not
--     a "safe to run again" file. The oldest handle for a studio is copied across below; the table
--     itself is no longer read by the app.
--
-- The write goes through a function rather than a column grant
--   * an UPDATE grant on `studios` would be table-wide, and the studio name and city would then be
--     writable by every member too. A security-definer function can change one column and nothing
--     else, and is the narrowest way to say "any member may edit this one field".
--   * it still runs as the caller for the auth check: auth.uid() must be present, and the function
--     is executable by `authenticated` only.


-- 1. the column ---------------------------------------------------------------------

alter table public.studios add column if not exists instagram text;

/* Instagram's own limit, so a typo cannot store something no account could ever have. Null is the
 * ordinary state: lots of studios do not have an account, and nothing asks twice. */
alter table public.studios drop constraint if exists studios_instagram_sane;
alter table public.studios add constraint studios_instagram_sane
  check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$');


-- 2. carry the old list across, one handle per studio --------------------------------
-- The oldest row wins: it is the one the page has shown longest, and when a studio has several
-- handles today there is no way to know which one the members consider the studio's own. The rest
-- stay in studio_instagrams, so nothing is lost.

do $$
begin
  if to_regclass('public.studio_instagrams') is not null then
    update public.studios s
       set instagram = pick.handle
      from (
        select distinct on (studio_id) studio_id, handle
          from public.studio_instagrams
         order by studio_id, created_at
      ) pick
     where pick.studio_id = s.id
       and s.instagram is null;
  end if;
end $$;


-- 3. the one way to write it --------------------------------------------------------

create or replace function public.set_studio_instagram(p_studio uuid, p_handle text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean text := nullif(btrim(coalesce(p_handle, '')), '');
begin
  /* The function runs with the owner's rights, so this check is what keeps it from becoming an
   * anonymous endpoint. PostgREST supplies auth.uid() from the caller's JWT. */
  if auth.uid() is null then
    raise exception 'Log in first.';
  end if;

  if clean is not null then
    /* The app already reduces @name and instagram.com/name to the handle (readInstagram in
     * js/store.js); this is the last line of defence for anything that calls the function directly. */
    clean := regexp_replace(clean, '^@+', '');
    if clean !~ '^[A-Za-z0-9._]{1,30}$' then
      raise exception 'That does not look like an Instagram handle: use the part after the @, up to 30 letters, numbers, dots or underscores.';
    end if;
  end if;

  update public.studios set instagram = clean where id = p_studio;
  if not found then
    raise exception 'That studio is not in the list.';
  end if;

  return clean;
end;
$$;

/* Authenticated only. A function in public is executable by PUBLIC by default, which would expose
 * the setter to the anon role even though its own check would refuse it. */
revoke all on function public.set_studio_instagram(uuid, text) from public, anon;
grant execute on function public.set_studio_instagram(uuid, text) to authenticated;

comment on function public.set_studio_instagram(uuid, text) is
  'Sets the one Instagram handle on a studio. Any signed-in member may call it; pass null or an empty string to clear it.';


-- 4. checking it afterwards ----------------------------------------------------------
-- Every studio and the one account the page will show:
--
--   select name, city, instagram from public.studios order by lower(name);
--
-- The handles that existed before this file was run, and whether the oldest one was carried across:
--
--   select s.name, s.instagram, i.handle, i.created_at
--     from public.studios s
--     left join public.studio_instagrams i on i.studio_id = s.id
--    order by lower(s.name), i.created_at;
--
-- Who may execute the setter - authenticated only:
--
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_name = 'set_studio_instagram';
--
-- If the studio page says the Instagram field is not switched on, this file has not been run. If
-- saving returns "Could not find the function", PostgREST has not picked it up yet - run
-- `notify pgrst, 'reload schema';` once in the SQL editor.
