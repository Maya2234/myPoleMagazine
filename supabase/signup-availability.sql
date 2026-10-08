-- Optional. Lets the registration form say "that email / username is already taken" before it
-- even attempts a signup.
--
-- The app works without this: store.js reads the same two cases off the signup response instead
-- (a duplicate email comes back as a fake success with no identities, and a duplicate username
-- makes the profiles trigger fail). Installing this just answers both questions in one round trip
-- without a failed signup attempt.
--
-- security definer, because a signed-out visitor may not read public.profiles or auth.users, so
-- the function looks on their behalf. It returns booleans only - the least it can reveal - but
-- note that it does let anyone check whether an address has an account here. That is a
-- deliberate trade-off for a prototype; if you would rather not expose that, delete the
-- email_taken column and the check in store.js will simply stop firing.
--
-- Run this once in the Supabase SQL editor.

create or replace function public.signup_availability(p_email text, p_username text)
returns table (email_taken boolean, username_taken boolean)
language sql
security definer
set search_path = public, auth
as $$
  select
    exists (select 1 from auth.users u where lower(u.email) = lower(trim(p_email))),
    exists (select 1 from public.profiles p where lower(p.username) = lower(trim(p_username)));
$$;

revoke all on function public.signup_availability(text, text) from public;
grant execute on function public.signup_availability(text, text) to anon, authenticated;
