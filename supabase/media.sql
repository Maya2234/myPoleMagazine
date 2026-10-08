-- Photos and videos on moves and Bible tricks.
-- Run this once in the Supabase SQL editor, after the base tables exist.
--
-- Files live in a private bucket called "media", one folder per uploader:
--     media/<uploader uuid>/<random>.<ext>
-- Private means nothing is served without a signed URL, which store.js asks for per file.
--
-- Who can see a file follows the app's account privacy rule: you can always see your own, and you
-- can see someone else's if their account is public. A private account's uploads stay visible to
-- its owner only. That is decided twice - once for the rows in public.media, once for the objects
-- in storage - because both the table and the bucket are behind row level security.

-- 1. the bucket ------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
              'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. a small helper the policies below share --------------------------------------
-- Security definer so the check does not depend on whether the reader may see profiles.

create or replace function public.account_is_public(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = p_id and not p.is_private);
$$;

grant execute on function public.account_is_public(uuid) to authenticated;

-- 3. the media table --------------------------------------------------------------
-- Exactly one parent: either a move of yours, or a Bible entry (which is shared).

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  move_id uuid references public.moves (id) on delete cascade,
  dictionary_entry_id uuid references public.dictionary_entries (id) on delete cascade,
  storage_path text not null unique,
  kind text not null check (kind in ('photo', 'video')),
  mime_type text,
  size_bytes bigint,
  caption text,
  created_at timestamptz not null default now(),
  constraint media_one_parent check ((move_id is null) <> (dictionary_entry_id is null))
);

create index if not exists media_move_idx on public.media (move_id);
create index if not exists media_entry_idx on public.media (dictionary_entry_id);

grant select, insert, update, delete on public.media to authenticated;
alter table public.media enable row level security;

drop policy if exists media_read on public.media;
create policy media_read on public.media for select to authenticated
  using (owner_id = auth.uid() or public.account_is_public(owner_id));

-- You may attach a file to your own move, or to a Bible entry you are allowed to see
-- (approved, or one of your own pending suggestions).
drop policy if exists media_insert on public.media;
create policy media_insert on public.media for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (
      exists (select 1 from public.moves m where m.id = move_id and m.user_id = auth.uid())
      or exists (select 1 from public.dictionary_entries e
                  where e.id = dictionary_entry_id
                    and (e.status = 'approved' or e.submitted_by = auth.uid()))
    )
  );

drop policy if exists media_update on public.media;
create policy media_update on public.media for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists media_delete on public.media;
create policy media_delete on public.media for delete to authenticated
  using (owner_id = auth.uid());

-- 4. the files themselves ---------------------------------------------------------
-- Ownership is read from the first folder in the path, which is the uploader's user id.

drop policy if exists media_files_read on storage.objects;
create policy media_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or ((storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
          and public.account_is_public(((storage.foldername(name))[1])::uuid))
    )
  );

drop policy if exists media_files_insert on storage.objects;
create policy media_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists media_files_update on storage.objects;
create policy media_files_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists media_files_delete on storage.objects;
create policy media_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
