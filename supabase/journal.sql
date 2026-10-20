-- The journal: private notes, and the photos and videos that go with them.
--
-- Run this once in the Supabase SQL editor, after media.sql. It is safe to run again: the two tables
-- are created only if they are missing, and the policies are dropped and recreated with the same
-- owner-only rule. If you already have journal_entries from an earlier setup, its rows are untouched.
--
-- Why a table of its own for the files rather than public.media
--   * a journal entry is private: no other member can read it, whatever their account privacy is.
--     media's read policy follows a public profile, so reusing it would make a public member's
--     journal files readable by anyone signed in.
--   * the private 'journal' bucket repeats that rule at the object level: the first path folder is
--     the owner's user id, and only that dancer may read, write or delete inside it.
--
-- The row is the record; deleting a journal entry cascades to its journal_media rows. The app still
-- removes the storage objects first, because deleting a row does not delete a file.


-- 1. the entries --------------------------------------------------------------------

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  entry_date date not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint journal_entries_body_len check (char_length(body) between 1 and 2000)
);

create index if not exists journal_entries_user_day_idx
  on public.journal_entries (user_id, entry_date desc, created_at desc);

grant select, insert, update, delete on public.journal_entries to authenticated;
alter table public.journal_entries enable row level security;

drop policy if exists journal_entries_read_own on public.journal_entries;
create policy journal_entries_read_own on public.journal_entries for select to authenticated
  using (user_id = auth.uid());

drop policy if exists journal_entries_insert_own on public.journal_entries;
create policy journal_entries_insert_own on public.journal_entries for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists journal_entries_update_own on public.journal_entries;
create policy journal_entries_update_own on public.journal_entries for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists journal_entries_delete_own on public.journal_entries;
create policy journal_entries_delete_own on public.journal_entries for delete to authenticated
  using (user_id = auth.uid());


-- 2. the photos and videos ----------------------------------------------------------

create table if not exists public.journal_media (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries (id) on delete cascade,
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  kind text not null check (kind in ('photo', 'video')),
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists journal_media_entry_idx
  on public.journal_media (journal_entry_id);

grant select, insert, delete on public.journal_media to authenticated;
alter table public.journal_media enable row level security;

drop policy if exists journal_media_read_own on public.journal_media;
create policy journal_media_read_own on public.journal_media for select to authenticated
  using (owner_id = auth.uid());

/* The owner check is repeated against the entry itself, so a path for somebody else's journal entry
 * cannot be inserted even though owner_id is mine. */
drop policy if exists journal_media_insert_own on public.journal_media;
create policy journal_media_insert_own on public.journal_media for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.journal_entries e
       where e.id = journal_entry_id and e.user_id = auth.uid()
    )
  );

drop policy if exists journal_media_delete_own on public.journal_media;
create policy journal_media_delete_own on public.journal_media for delete to authenticated
  using (owner_id = auth.uid());


-- 3. the private files --------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal', 'journal', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
              'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists journal_files_read on storage.objects;
create policy journal_files_read on storage.objects for select to authenticated
  using (bucket_id = 'journal' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists journal_files_insert on storage.objects;
create policy journal_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'journal' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists journal_files_update on storage.objects;
create policy journal_files_update on storage.objects for update to authenticated
  using (bucket_id = 'journal' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists journal_files_delete on storage.objects;
create policy journal_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'journal' and (storage.foldername(name))[1] = auth.uid()::text);

-- Checking it afterwards
--   select count(*) from public.journal_entries;
--   select id, name, public from storage.buckets where id = 'journal';
--   select policyname, cmd from pg_policies where tablename in ('journal_entries', 'journal_media')
--    order by tablename, policyname;
--
-- If the journal says its photos are not switched on, this file has not been run. The notes still
-- work without it; only the file table and bucket are new.
