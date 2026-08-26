drop policy if exists "owners read private museum objects" on storage.objects;
create policy "owners read private museum objects"
on storage.objects for select
using (
  bucket_id = 'museum-private'
  and exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.museum_id::text =
        (storage.foldername(storage.objects.name))[1]
      and a.id::text =
        (storage.foldername(storage.objects.name))[2]
      and m.owner_id = auth.uid()
  )
);

drop policy if exists "owners upload authorized temporary museum objects"
on storage.objects;
create policy "owners upload authorized temporary museum objects"
on storage.objects for insert
with check (
  bucket_id = 'museum-private'
  and (storage.foldername(storage.objects.name))[3] = 'temp'
  and exists (
    select 1
    from public.media_upload_sessions s
    join public.artworks a on a.id = s.artwork_id
    join public.museum_profiles m on m.id = s.museum_id
    where s.owner_id = auth.uid()
      and m.owner_id = auth.uid()
      and s.museum_id = a.museum_id
      and s.museum_id::text =
        (storage.foldername(storage.objects.name))[1]
      and s.artwork_id::text =
        (storage.foldername(storage.objects.name))[2]
      and s.status = 'authorized'
      and s.expires_at > now()
      and s.authorized_paths ? storage.objects.name
  )
);

drop policy if exists "owners update authorized temporary museum objects"
on storage.objects;
create policy "owners update authorized temporary museum objects"
on storage.objects for update
using (
  bucket_id = 'museum-private'
  and (storage.foldername(storage.objects.name))[3] = 'temp'
  and exists (
    select 1
    from public.media_upload_sessions s
    join public.artworks a on a.id = s.artwork_id
    join public.museum_profiles m on m.id = s.museum_id
    where s.owner_id = auth.uid()
      and m.owner_id = auth.uid()
      and s.museum_id = a.museum_id
      and s.museum_id::text =
        (storage.foldername(storage.objects.name))[1]
      and s.artwork_id::text =
        (storage.foldername(storage.objects.name))[2]
      and s.status = 'authorized'
      and s.expires_at > now()
      and s.authorized_paths ? storage.objects.name
  )
)
with check (
  bucket_id = 'museum-private'
  and (storage.foldername(storage.objects.name))[3] = 'temp'
  and exists (
    select 1
    from public.media_upload_sessions s
    join public.artworks a on a.id = s.artwork_id
    join public.museum_profiles m on m.id = s.museum_id
    where s.owner_id = auth.uid()
      and m.owner_id = auth.uid()
      and s.museum_id = a.museum_id
      and s.museum_id::text =
        (storage.foldername(storage.objects.name))[1]
      and s.artwork_id::text =
        (storage.foldername(storage.objects.name))[2]
      and s.status = 'authorized'
      and s.expires_at > now()
      and s.authorized_paths ? storage.objects.name
  )
);

drop policy if exists "owners delete private museum objects"
on storage.objects;
create policy "owners delete authorized temporary museum objects"
on storage.objects for delete
using (
  bucket_id = 'museum-private'
  and (storage.foldername(storage.objects.name))[3] = 'temp'
  and exists (
    select 1
    from public.media_upload_sessions s
    join public.artworks a on a.id = s.artwork_id
    join public.museum_profiles m on m.id = s.museum_id
    where s.owner_id = auth.uid()
      and m.owner_id = auth.uid()
      and s.museum_id = a.museum_id
      and s.museum_id::text =
        (storage.foldername(storage.objects.name))[1]
      and s.artwork_id::text =
        (storage.foldername(storage.objects.name))[2]
      and s.status in ('authorized', 'failed', 'cleanup_queued')
      and s.authorized_paths ? storage.objects.name
  )
);
