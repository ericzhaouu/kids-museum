create or replace function public.enqueue_media_cleanup_job(
  p_museum_id uuid,
  p_owner_id uuid,
  p_scope text,
  p_object_paths jsonb default '[]'::jsonb,
  p_tombstone_museum_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_clean_paths text[] := array[]::text[];
  v_job_id uuid;
begin
  if auth.uid() is null or p_owner_id <> auth.uid() then
    raise exception 'MEDIA_CLEANUP_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.museum_profiles m
    where m.id = p_museum_id
      and m.owner_id = auth.uid()
  ) and not exists (
    select 1
    from public.museum_tombstones t
    where t.museum_id = p_museum_id
      and t.owner_id = auth.uid()
  ) then
    raise exception 'MEDIA_CLEANUP_FORBIDDEN';
  end if;

  if p_tombstone_museum_id is not null
     and p_tombstone_museum_id <> p_museum_id then
    raise exception 'MEDIA_CLEANUP_FORBIDDEN';
  end if;

  if jsonb_typeof(coalesce(p_object_paths, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_MEDIA_CLEANUP_PATHS';
  end if;

  for v_path in
    select distinct btrim(value)
    from jsonb_array_elements_text(coalesce(p_object_paths, '[]'::jsonb))
    where char_length(btrim(value)) > 0
  loop
    if v_path not like p_museum_id::text || '/%'
       or v_path like '%..%'
       or v_path like '%\%' then
      raise exception 'INVALID_MEDIA_CLEANUP_PATH';
    end if;
    v_clean_paths := array_append(v_clean_paths, v_path);
  end loop;

  if cardinality(v_clean_paths) = 0 then
    return null;
  end if;

  insert into public.media_cleanup_jobs (
    museum_id,
    owner_id,
    tombstone_museum_id,
    scope,
    object_paths
  )
  values (
    p_museum_id,
    p_owner_id,
    p_tombstone_museum_id,
    p_scope,
    to_jsonb(v_clean_paths)
  )
  returning id into v_job_id;

  return v_job_id;
end;
$$;

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
) to authenticated;

create or replace function public.claim_media_cleanup_jobs(
  p_limit integer default 20,
  p_lease_seconds integer default 300
)
returns setof public.media_cleanup_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'MEDIA_CLEANUP_WORKER_FORBIDDEN';
  end if;

  return query
  with candidates as (
    select j.id
    from public.media_cleanup_jobs j
    where j.not_before <= now()
      and (
        j.status in ('pending', 'failed')
        or (
          j.status = 'processing'
          and j.last_processed_at < now() - make_interval(secs => greatest(p_lease_seconds, 60))
        )
      )
    order by j.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.media_cleanup_jobs j
  set status = 'processing',
      attempt_count = j.attempt_count + 1,
      last_error = null,
      last_processed_at = now()
  from candidates c
  where j.id = c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_media_cleanup_jobs(integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_media_cleanup_jobs(integer, integer)
to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'museum-private',
  'museum-private',
  false,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'audio/webm',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/ogg'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
