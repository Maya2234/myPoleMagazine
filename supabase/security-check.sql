-- A security check for the dictionary review path. Run it in the Supabase SQL editor, and again after any
-- change to a policy or a grant. It answers the questions that matter:
--
--   * can a signed-in dancer publish a trick without review?
--   * can they approve, or reject, someone else's suggestion?
--   * can they read other members' pending suggestions?
--   * can they make themselves an admin?
--   * can a visitor with no account do any of it?
--
-- Nothing here changes the database: every hostile attempt runs inside a subtransaction that is
-- rolled back on the next line through a sentinel exception, so even an attempt that succeeds leaves
-- no row behind. Fixtures are made the same way and rolled back with it.
--
-- Read the verdicts like this:
--
--   ok               the database did what it should
--   VULNERABLE       it did not - this is the thing to fix
--   UNEXPECTED       it refused something it should have allowed (an admin's own review work)
--   not applicable   the table or function this test needs does not exist yet
--
-- How it pretends to be someone: PostgREST authenticates a request by setting the JWT claims and
-- switching to the `authenticated` role, so that is what this does. No password, no session and no
-- account of anyone else's is needed - which is the only reason this can be tested at all.


drop table if exists sec_findings;
create temp table sec_findings (
  seq serial primary key,
  area text,
  attempt text,
  verdict text
);


/* The identity switch, in one place: the claims PostgREST sets and the role it switches to. Both
 * spellings are set because auth.uid() reads whichever this project's version of it looks at - the
 * JSON `request.jwt.claims` in newer Supabase projects, the individual `request.jwt.claim.sub` in
 * older ones - and pretending to be someone has to work against either. */
create or replace function pg_temp.become(p_uid uuid)
returns void
language plpgsql
as $$
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.role', 'anon', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
  end if;
end $$;


/* `expect` is what the database should do here: 'blocked' for a dancer and for a visitor with no
 * account, 'allowed' for an admin doing the review work they are there for. */
create or replace function pg_temp.probe_review(p_uid uuid, p_area text, p_expect text)
returns table (area text, attempt text, verdict text)
language plpgsql
as $$
declare
  v_danger boolean;      -- did the hostile thing actually happen?
  v_detail text;
  v_rows int;
  v_victim uuid;
  v_other uuid;
  v_name text;
  v_user text;
begin
  /* Pick, or make, the thing each test attacks - as the session's own user, before the role switch,
   * so the fixture is never blocked by the policies under test. Rolled back with everything else. */
  select id into v_victim from public.dictionary_entries
   where status = 'pending' and submitted_by is distinct from p_uid
   order by created_at limit 1;
  select id into v_other from public.profiles where id is distinct from p_uid order by id limit 1;

  if v_victim is null then
    v_name := 'zz security fixture ' || replace(clock_timestamp()::text, ' ', '-');
    insert into public.dictionary_entries (name, status, submitted_by) values (v_name, 'pending', v_other);
    select id into v_victim from public.dictionary_entries where name = v_name;
  end if;

  select username into v_user from public.profiles where id = p_uid;

  /* ---------- 1. publishing a trick without review ---------- */
  v_danger := null;
  begin
    v_name := 'zz security probe ' || replace(clock_timestamp()::text, ' ', '-');
    perform pg_temp.become(p_uid);
    insert into public.dictionary_entries (name, status) values (v_name, 'approved');
    select status = 'approved' into v_danger from public.dictionary_entries where name = v_name;
    v_detail := 'asking for approved stored ' || (case when v_danger then 'approved' else 'pending' end);
    raise exception 'SEC_ROLLBACK';
  exception when others then
    if sqlerrm <> 'SEC_ROLLBACK' then v_danger := false; v_detail := 'refused: ' || sqlerrm; end if;
  end;
  area := p_area; attempt := 'publish a trick without review';
  verdict := case
    when v_danger = (p_expect = 'allowed') then 'ok: ' || v_detail
    when v_danger then 'VULNERABLE: ' || v_detail || ' - review can be skipped'
    else 'UNEXPECTED: ' || v_detail || ' - an admin should publish directly'
  end;
  return next;

  /* ---------- 2. approving someone else's suggestion ---------- */
  v_danger := null;
  begin
    perform pg_temp.become(p_uid);
    update public.dictionary_entries set status = 'approved' where id = v_victim;
    get diagnostics v_rows = row_count;
    v_danger := v_rows > 0;
    v_detail := 'approving another dancer''s row changed ' || v_rows || ' row(s)';
    raise exception 'SEC_ROLLBACK';
  exception when others then
    if sqlerrm <> 'SEC_ROLLBACK' then v_danger := false; v_detail := 'refused: ' || sqlerrm; end if;
  end;
  area := p_area; attempt := 'approve someone else''s suggestion';
  verdict := case
    when v_danger = (p_expect = 'allowed') then 'ok: ' || v_detail
    when v_danger then 'VULNERABLE: ' || v_detail
    else 'UNEXPECTED: ' || v_detail || ' - an admin must be able to approve'
  end;
  return next;

  /* ---------- 3. rejecting (deleting) someone else's suggestion ---------- */
  v_danger := null;
  begin
    perform pg_temp.become(p_uid);
    delete from public.dictionary_entries where id = v_victim;
    get diagnostics v_rows = row_count;
    v_danger := v_rows > 0;
    v_detail := 'rejecting another dancer''s row removed ' || v_rows || ' row(s)';
    raise exception 'SEC_ROLLBACK';
  exception when others then
    if sqlerrm <> 'SEC_ROLLBACK' then v_danger := false; v_detail := 'refused: ' || sqlerrm; end if;
  end;
  area := p_area; attempt := 'reject someone else''s suggestion';
  verdict := case
    when v_danger = (p_expect = 'allowed') then 'ok: ' || v_detail
    when v_danger then 'VULNERABLE: ' || v_detail
    else 'UNEXPECTED: ' || v_detail || ' - an admin must be able to reject'
  end;
  return next;

  /* ---------- 4. reading other members' pending suggestions ---------- */
  v_danger := null;
  begin
    perform pg_temp.become(p_uid);
    select count(*) into v_rows from public.dictionary_entries
     where status = 'pending' and submitted_by is distinct from p_uid;
    v_danger := v_rows > 0;
    v_detail := v_rows || ' pending suggestion(s) of other members visible';
    raise exception 'SEC_ROLLBACK';
  exception when others then
    if sqlerrm <> 'SEC_ROLLBACK' then v_danger := false; v_detail := 'refused: ' || sqlerrm; end if;
  end;
  area := p_area; attempt := 'read other members'' pending suggestions';
  verdict := case
    when v_danger = (p_expect = 'allowed') then 'ok: ' || v_detail
    when v_danger then 'VULNERABLE: ' || v_detail
    else 'UNEXPECTED: ' || v_detail || ' - an admin reviews these'
  end;
  return next;

  /* ---------- 5. making themselves an admin ---------- */
  v_danger := null;
  begin
    perform pg_temp.become(p_uid);
    update public.profiles set is_admin = true where id = p_uid;
    select is_admin into v_danger from public.profiles where id = p_uid;
    v_danger := coalesce(v_danger, false);
    v_detail := 'after writing is_admin = true it reads ' || (case when v_danger then 'true' else 'false' end);
    raise exception 'SEC_ROLLBACK';
  exception when others then
    if sqlerrm <> 'SEC_ROLLBACK' then v_danger := false; v_detail := 'refused: ' || sqlerrm; end if;
  end;
  area := p_area; attempt := 'set is_admin on their own profile';
  verdict := case
    when v_danger then 'VULNERABLE: ' || v_detail || ' - anyone could review and publish'
    else 'ok: ' || v_detail
  end;
  return next;

  /* ---------- 6. writing the admins table directly ---------- */
  v_danger := null;
  begin
    perform pg_temp.become(p_uid);
    insert into public.admins (user_id) values (coalesce(p_uid, v_other));
    v_danger := true;
    v_detail := 'a row was written into public.admins';
    raise exception 'SEC_ROLLBACK';
  exception
    when undefined_table then v_danger := false; v_detail := 'not applicable: public.admins does not exist yet';
    when others then
      if sqlerrm <> 'SEC_ROLLBACK' then v_danger := false; v_detail := 'refused: ' || sqlerrm; end if;
  end;
  area := p_area; attempt := 'write a row into the admins table';
  verdict := case
    when v_danger then 'VULNERABLE: ' || v_detail
    when v_detail like 'not applicable%' then v_detail
    else 'ok: ' || v_detail
  end;
  return next;

  /* ---------- 7. promoting an account through grant_admin() ---------- */
  v_danger := null;
  begin
    perform pg_temp.become(p_uid);
    execute 'select public.grant_admin($1)' using coalesce(v_user, 'nobody');
    v_danger := true;
    v_detail := 'grant_admin() promoted an account';
    raise exception 'SEC_ROLLBACK';
  exception
    when undefined_function then v_danger := false; v_detail := 'not applicable: grant_admin() does not exist yet';
    when others then
      if sqlerrm <> 'SEC_ROLLBACK' then v_danger := false; v_detail := 'refused: ' || sqlerrm; end if;
  end;
  area := p_area; attempt := 'promote an account through grant_admin()';
  verdict := case
    when v_danger = (p_expect = 'allowed') then 'ok: ' || v_detail
    when v_danger then 'VULNERABLE: ' || v_detail
    when v_detail like 'not applicable%' then v_detail
    else 'ok: ' || v_detail
  end;
  return next;

  /* ---------- 8. reading the admin audit trail ---------- */
  v_danger := null;
  begin
    perform pg_temp.become(p_uid);
    select count(*) into v_rows from public.admin_audit;
    v_danger := v_rows > 0;
    v_detail := v_rows || ' audit row(s) visible';
    raise exception 'SEC_ROLLBACK';
  exception
    when undefined_table then v_danger := false; v_detail := 'not applicable: public.admin_audit does not exist yet';
    when others then
      if sqlerrm <> 'SEC_ROLLBACK' then v_danger := false; v_detail := 'refused: ' || sqlerrm; end if;
  end;
  /* No client is meant to read the audit trail, an admin included, so any refusal here is fine and
   * only a result that actually showed rows is a finding. */
  area := p_area; attempt := 'read the admin audit trail';
  verdict := case
    when v_danger then 'VULNERABLE: ' || v_detail
    else 'ok: ' || v_detail
  end;
  return next;
end $$;


/* Three ways round: a dancer who is not an admin, an admin, and somebody with no account. */
insert into sec_findings (area, attempt, verdict)
select * from pg_temp.probe_review(
  (select id from public.profiles where not is_admin order by username limit 1), 'a dancer', 'blocked');

insert into sec_findings (area, attempt, verdict)
select * from pg_temp.probe_review(
  (select id from public.profiles where is_admin order by username limit 1), 'an admin', 'allowed');

insert into sec_findings (area, attempt, verdict)
select * from pg_temp.probe_review(null, 'no account', 'blocked');


/* What the database grants the browser, and the rules it holds. Context for the verdicts above. */
insert into sec_findings (area, attempt, verdict)
select 'grants', 'columns authenticated may UPDATE on profiles',
       coalesce(string_agg(column_name, ', ' order by column_name), '(none)')
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'profiles'
   and grantee = 'authenticated' and privilege_type = 'UPDATE';

insert into sec_findings (area, attempt, verdict)
select 'grants', 'table-wide UPDATE granted to authenticated on profiles',
       case when exists (select 1 from information_schema.role_table_grants
                          where table_schema = 'public' and table_name = 'profiles'
                            and grantee = 'authenticated' and privilege_type = 'UPDATE')
            then 'yes - still there, so is_admin remains writable from the browser'
            else 'no - only the columns listed above' end;

insert into sec_findings (area, attempt, verdict)
select 'rules', cmd || ' policies on dictionary_entries',
       coalesce(string_agg(policyname, ' | ' order by policyname), '(none)')
  from pg_policies
 where schemaname = 'public' and tablename = 'dictionary_entries'
 group by cmd
 order by cmd;

insert into sec_findings (area, attempt, verdict)
select 'rules', 'trigger forcing the status of a new entry',
       case when exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                          where c.relname = 'dictionary_entries' and not t.tgisinternal
                            and t.tgname = 'dictionary_entries_force_status')
            then 'installed' else 'missing - a client can ask for approved' end;

insert into sec_findings (area, attempt, verdict)
select 'rules', 'every overload of is_admin() in the database',
       coalesce(string_agg(p.oid::regprocedure::text, ' | '), '(none)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'is_admin';


select seq, area, attempt, verdict from sec_findings order by seq;

select count(*) filter (where verdict like 'VULNERABLE%')      as vulnerabilities,
       count(*) filter (where verdict like 'UNEXPECTED%')      as too_strict,
       count(*) filter (where verdict like 'not applicable%')  as not_applicable
  from sec_findings;
