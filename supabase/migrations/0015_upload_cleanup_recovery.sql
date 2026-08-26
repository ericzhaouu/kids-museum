create or replace function public.queue_expired_media_upload_session_cleanups(
  p_limit integer default 50
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_queued integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'MEDIA_UPLOAD_SESSION_WORKER_FORBIDDEN';
  end if;

  with candidates as (
    select s.id
    from public.media_upload_sessions s
    where (
        s.status in ('authorized', 'failed')
        and s.expires_at <= now()
      )
      or (
        s.status = 'committed'
        and s.cleanup_queued_at is null
        and s.committed_at <= now() - interval '5 minutes'
      )
    order by coalesce(s.committed_at, s.expires_at), s.id
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  ), updated as (
    update public.media_upload_sessions s
    set status = 'cleanup_queued',
        cleanup_queued_at = now(),
        last_error = coalesce(
          s.last_error,
          case
            when s.status = 'committed'
              then 'MEDIA_UPLOAD_SESSION_CLEANUP_RETRY'
            else 'MEDIA_UPLOAD_SESSION_EXPIRED'
          end
        )
    from candidates c
    where s.id = c.id
    returning s.museum_id, s.owner_id, s.authorized_paths
  )
  insert into public.media_cleanup_jobs (
    museum_id,
    owner_id,
    scope,
    object_paths
  )
  select
    u.museum_id,
    u.owner_id,
    'artwork.upload.session.recovery',
    u.authorized_paths
  from updated u
  where jsonb_array_length(u.authorized_paths) > 0;

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

create or replace function public.delete_museum_permanently()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_museum public.museum_profiles%rowtype;
  v_paths text[];
  v_cleanup_job_id uuid;
begin
  select *
  into v_museum
  from public.museum_profiles
  where owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'MUSEUM_NOT_FOUND';
  end if;

  select coalesce(array_agg(distinct path), array[]::text[])
  into v_paths
  from (
    select aa.storage_path as path
    from public.artworks a
    join public.artwork_assets aa on aa.artwork_id = a.id
    where a.museum_id = v_museum.id
    union all
    select jsonb_array_elements_text(s.authorized_paths) as path
    from public.media_upload_sessions s
    where s.museum_id = v_museum.id
  ) registered_paths;

  insert into public.museum_tombstones (
    museum_id,
    owner_id,
    museum_name,
    artist_nickname,
    theme_id,
    theme_version,
    metadata
  )
  values (
    v_museum.id,
    v_museum.owner_id,
    v_museum.name,
    v_museum.artist_nickname,
    v_museum.theme_id,
    v_museum.theme_version,
    jsonb_build_object(
      'assetCount', cardinality(v_paths),
      'preservedAuthUser', true
    )
  )
  on conflict (museum_id)
  do update set
    owner_id = excluded.owner_id,
    museum_name = excluded.museum_name,
    artist_nickname = excluded.artist_nickname,
    theme_id = excluded.theme_id,
    theme_version = excluded.theme_version,
    deleted_at = now(),
    cleanup_status = 'pending',
    last_error = null,
    metadata = excluded.metadata;

  v_cleanup_job_id := public.enqueue_media_cleanup_job(
    v_museum.id,
    auth.uid(),
    'museum.delete',
    to_jsonb(v_paths),
    v_museum.id
  );

  update public.museum_tombstones
  set metadata = metadata || jsonb_build_object(
    'cleanupJobId',
    v_cleanup_job_id
  )
  where museum_id = v_museum.id;

  delete from public.museum_profiles
  where id = v_museum.id;

  return jsonb_build_object(
    'museumId', v_museum.id,
    'cleanupJobId', v_cleanup_job_id,
    'deletedAt', now(),
    'preservedAuthUser', true
  );
end;
$$;
