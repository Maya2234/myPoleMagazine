-- Support messages: every message the contact form sends, written down where an admin can read it.
--
-- Run this once in the Supabase SQL editor, after the base tables exist. It is written to be safe to
-- run again: nothing already in the database is deleted or rewritten.
--
-- #/support is the one screen that works while signed out, and until this file existed it had no
-- memory at all. The message went to the `support` Edge Function, which emailed it through Resend
-- and forgot it. If that email was refused, swallowed by a spam filter, or the key was wrong, the
-- sender was told their message was on its way and nobody ever saw it - and the people most likely
-- to write in are the ones with no account to check anything from.
--
-- So the function writes the message down here first and emails it second. This table is the record;
-- the email is a notification about the record. A failed email is then a visible, fixable state
-- ("stored, never emailed") rather than a lost message.
--
-- Who can see what
--   * an admin, and nobody else: these carry the name, the address and the words of somebody who may
--     have no account at all, so they are not shared with the members who sent them.
--   * no browser writes a row. The only writer is the Edge Function, which holds the service role
--     key; there is no insert grant and no insert policy below, on purpose.
--
-- Admin rights themselves come from supabase/admins.sql, which must have been run: the policies here
-- call public.is_admin(), the same function the review queue's policies call.


-- 1. the messages ------------------------------------------------------------------

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  /* All five of these are copies of what the form sent rather than references to anything: most
   * messages come from visitors who are not signed in, and a member who writes in and later closes
   * their account must not take the message with them. */
  name text,
  email text not null,
  subject text,
  message text not null,
  username text,
  /* Whether Resend accepted it, and what it said when it did not. Two fields rather than one status
   * word: "written down but never emailed" is the exact state this table exists to expose, and it
   * has to be visible at a glance in the inbox. */
  emailed boolean not null default false,
  email_error text,
  /* The admin's own flag, so the inbox can hide what has already been dealt with. */
  handled boolean not null default false,
  created_at timestamptz not null default now(),
  /* The same caps the form and the function apply, restated here as the last word: the function is
   * not the only thing that could ever write to this table. */
  constraint support_messages_message_len check (char_length(message) between 1 and 4000),
  constraint support_messages_email_len check (char_length(btrim(email)) between 3 and 160),
  constraint support_messages_name_len check (name is null or char_length(name) <= 80),
  constraint support_messages_subject_len check (subject is null or char_length(subject) <= 120),
  constraint support_messages_username_len check (username is null or char_length(username) <= 60)
);

-- Newest first is the only order the inbox ever asks for.
create index if not exists support_messages_created_idx
  on public.support_messages (created_at desc);


-- 2. who may read them --------------------------------------------------------------
-- Insert is deliberately absent in both places, and the revoke is not a formality: a new table in
-- this schema arrives with the wide default grants, so without it a signed-in dancer could POST a
-- row straight past the form. The form goes through the function, which is what holds the honeypot
-- and the caps, and the function writes with the service role - it needs no policy at all, because
-- that key is not subject to row level security.
--
-- So a row arrives from the function or not at all.

revoke insert, delete on public.support_messages from authenticated;
grant select, update on public.support_messages to authenticated;
/* The function's own rights, spelled out rather than left to the schema's defaults, so this file
 * says who writes the table wherever it is read. */
grant select, insert, update on public.support_messages to service_role;
alter table public.support_messages enable row level security;

drop policy if exists support_messages_read_admin on public.support_messages;
create policy support_messages_read_admin on public.support_messages for select to authenticated
  using (public.is_admin());

-- Marking one handled is the only edit the app makes. Nothing deletes a message from the app: a
-- support message is the record of somebody asking for help, and losing one to a mistap is exactly
-- the failure this file was written to end. Removing rows is a deliberate act in the SQL editor.
drop policy if exists support_messages_update_admin on public.support_messages;
create policy support_messages_update_admin on public.support_messages for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- 3. checking it afterwards ---------------------------------------------------------
-- What is waiting for an answer, and what the mail did with it, in one query:
--
--   select count(*) filter (where not handled)   as waiting,
--          count(*) filter (where not emailed)   as never_emailed,
--          count(*)                              as total
--     from public.support_messages;
--
-- Everything the mail never delivered, with what Resend said at the time - this is the list that used
-- to be invisible:
--
--   select created_at, coalesce(name, 'a visitor') as from_who, email, subject, email_error
--     from public.support_messages
--    where not emailed
--    order by created_at desc;
--
-- What the browser may do with the table - select and update, and no insert or delete:
--
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'support_messages'
--    order by grantee, privilege_type;
--
-- If the app's inbox says support messages are not switched on, this file has not been run. If the
-- form reports that nothing was received while this table has no new row, the Edge Function is the
-- old copy and needs redeploying: supabase/functions/support/index.ts is the half that writes here.
