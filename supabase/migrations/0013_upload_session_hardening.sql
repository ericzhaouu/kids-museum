revoke all on function public.enqueue_media_cleanup_job(
  uuid,
  uuid,
  text,
  jsonb,
  uuid
) from public, anon;
grant execute on function public.enqueue_media_cleanup_job(
  uuid,
  uuid,
  text,
  jsonb,
  uuid
) to authenticated, service_role;

drop policy if exists "owners upload private museum objects" on storage.objects;
create policy "owners upload authorized temporary museum objects"
on storage.objects for insert
with check (
  bucket_id = 'museum-private'
  and (storage.foldername(name))[3] = 'temp'
  and exists (
    select 1
    from public.media_upload_sessions s
    join public.artworks a on a.id = s.artwork_id
    join public.museum_profiles m on m.id = s.museum_id
    where s.owner_id = auth.uid()
      and m.owner_id = auth.uid()
      and s.museum_id = a.museum_id
      and s.museum_id::text = (storage.foldername(name))[1]
      and s.artwork_id::text = (storage.foldername(name))[2]
      and s.status = 'authorized'
      and s.expires_at > now()
      and s.authorized_paths ? name
  )
);

drop policy if exists "owners update private museum objects" on storage.objects;
create policy "owners update authorized temporary museum objects"
on storage.objects for update
using (
  bucket_id = 'museum-private'
  and (storage.foldername(name))[3] = 'temp'
  and exists (
    select 1
    from public.media_upload_sessions s
    join public.artworks a on a.id = s.artwork_id
    join public.museum_profiles m on m.id = s.museum_id
    where s.owner_id = auth.uid()
      and m.owner_id = auth.uid()
      and s.museum_id = a.museum_id
      and s.museum_id::text = (storage.foldername(name))[1]
      and s.artwork_id::text = (storage.foldername(name))[2]
      and s.status = 'authorized'
      and s.expires_at > now()
      and s.authorized_paths ? name
  )
)
with check (
  bucket_id = 'museum-private'
  and (storage.foldername(name))[3] = 'temp'
  and exists (
    select 1
    from public.media_upload_sessions s
    join public.artworks a on a.id = s.artwork_id
    join public.museum_profiles m on m.id = s.museum_id
    where s.owner_id = auth.uid()
      and m.owner_id = auth.uid()
      and s.museum_id = a.museum_id
      and s.museum_id::text = (storage.foldername(name))[1]
      and s.artwork_id::text = (storage.foldername(name))[2]
      and s.status = 'authorized'
      and s.expires_at > now()
      and s.authorized_paths ? name
  )
);

create or replace function public.delete_artwork(p_artwork_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artwork public.artworks%rowtype;
  v_paths text[];
  v_cleanup_job_id uuid;
begin
  select a.*
  into v_artwork
  from public.artworks a
  join public.museum_profiles m on m.id = a.museum_id
  where a.id = p_artwork_id
    and m.owner_id = auth.uid()
  for update of a;

  if not found then
    return null;
  end if;

  if exists (
    select 1
    from public.room_artworks ra
    join public.exhibition_rooms r on r.id = ra.room_id
    join public.exhibitions e on e.id = r.exhibition_id
    where ra.artwork_id = p_artwork_id
      and e.status = 'published'
  ) then
    raise exception 'ARTWORK_IN_PUBLISHED_EXHIBITION';
  end if;

  select coalesce(array_agg(distinct path), array[]::text[])
  into v_paths
  from (
    select aa.storage_path as path
    from public.artwork_assets aa
    where aa.artwork_id = p_artwork_id
    union all
    select jsonb_array_elements_text(s.authorized_paths) as path
    from public.media_upload_sessions s
    where s.artwork_id = p_artwork_id
      and (
        s.status in ('authorized', 'failed', 'cleanup_queued')
        or (s.status = 'committed' and s.cleanup_queued_at is null)
      )
  ) registered_paths;

  v_cleanup_job_id := public.enqueue_media_cleanup_job(
    v_artwork.museum_id,
    auth.uid(),
    'artwork.delete',
    to_jsonb(v_paths)
  );

  insert into public.audit_events (
    museum_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values (
    v_artwork.museum_id,
    auth.uid(),
    'artwork.deleted',
    'artwork',
    p_artwork_id,
    jsonb_build_object(
      'assetCount', cardinality(v_paths),
      'cleanupJobId', v_cleanup_job_id
    )
  );

  delete from public.artworks
  where id = p_artwork_id;

  return jsonb_build_object(
    'cleanupJobId', v_cleanup_job_id,
    'paths', to_jsonb(v_paths)
  );
end;
$$;
