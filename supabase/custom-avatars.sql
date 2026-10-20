-- Uploaded profile photos: a public bucket that each dancer may write only inside their own folder.
--
-- Run this once in the Supabase SQL editor, after social.sql (which adds profiles.avatar) and
-- media.sql (which creates the storage schema helpers this uses). It is safe to run again.
--
-- Why a bucket of its own rather than the media bucket
--   * media is private and its read policy follows the account privacy rule. An avatar has to draw
--     beside a name in lists and pages that already decide who may see the profile, and asking for a
--     signed URL for every avatar in every list would be a round trip per member.
--   * so avatars are public objects with an unguessable name, the way a profile picture usually is.
--     Only the owner may write or delete inside their own <user-id>/ folder; anybody may read.
--
-- profiles.avatar keeps its old job as well: a preset key such as 'pleaser-pink' still means the
-- artwork in icons/avatars/. An uploaded photo is stored as 'user:<storage path>' in the same column,
-- so no profile column or grant had to change. The app builds the public URL from the path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The path is always <uploader uuid>/<random>.<ext>, the same ownership rule the media bucket uses.
drop policy if exists avatar_files_read on storage.objects;
create policy avatar_files_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

drop policy if exists avatar_files_insert on storage.objects;
create policy avatar_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatar_files_update on storage.objects;
create policy avatar_files_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatar_files_delete on storage.objects;
create policy avatar_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Checking it afterwards
--   select id, name, public, file_size_limit from storage.buckets where id = 'avatars';
--   select policyname, cmd from pg_policies where tablename = 'objects'
--    and policyname like 'avatar_files_%' order by policyname;
--
-- If uploading a photo says profile photos are not switched on, this file has not been run. If it
-- says the bucket is missing, re-run it - the insert above is the only thing that creates it.
