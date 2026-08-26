create table if not exists public.museum_tombstones (
  museum_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  museum_name text not null check (char_length(museum_name) between 1 and 80),
  artist_nickname text not null check (char_length(artist_nickname) between 1 and 40),
  theme_id text not null,
  theme_version integer not null check (theme_version > 0),
  deleted_at timestamptz not null default now(),
  cleanup_status text not null default 'pending' check (
    cleanup_status in ('pending', 'processing', 'completed', 'failed')
  ),
  last_error text,
  last_processed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.media_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  museum_id uuid not null,
  owner_id uuid references auth.users(id) on delete set null,
  tombstone_museum_id uuid references public.museum_tombstones(museum_id) on delete set null,
  scope text not null check (char_length(scope) between 1 and 80),
  bucket_id text not null default 'museum-private' check (char_length(bucket_id) between 1 and 80),
  object_paths jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'completed', 'failed')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_processed_at timestamptz,
  not_before timestamptz not null default now(),
  check (jsonb_typeof(object_paths) = 'array')
);

create index if not exists media_cleanup_jobs_status_idx
on public.media_cleanup_jobs (status, not_before, created_at);

create trigger media_cleanup_jobs_set_updated_at
before update on public.media_cleanup_jobs
for each row execute procedure public.set_updated_at();

alter table public.museum_tombstones enable row level security;
alter table public.media_cleanup_jobs enable row level security;

drop policy if exists "owners inspect museum tombstones"
on public.museum_tombstones;
create policy "owners inspect museum tombstones"
on public.museum_tombstones for select
using (owner_id = auth.uid());

drop policy if exists "owners create museum tombstones"
on public.museum_tombstones;
create policy "owners create museum tombstones"
on public.museum_tombstones for insert
with check (owner_id = auth.uid());

drop policy if exists "owners update museum tombstones"
on public.museum_tombstones;
create policy "owners update museum tombstones"
on public.museum_tombstones for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "owners inspect media cleanup jobs"
on public.media_cleanup_jobs;
create policy "owners inspect media cleanup jobs"
on public.media_cleanup_jobs for select
using (owner_id = auth.uid());

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
  if jsonb_typeof(coalesce(p_object_paths, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_MEDIA_CLEANUP_PATHS';
  end if;

  for v_path in
    select distinct btrim(value)
    from jsonb_array_elements_text(coalesce(p_object_paths, '[]'::jsonb))
    where char_length(btrim(value)) > 0
  loop
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

create or replace function public.replace_artwork_assets(
  p_artwork_id uuid,
  p_assets jsonb,
  p_scope text default 'artwork.asset.replace'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artwork public.artworks%rowtype;
  v_asset jsonb;
  v_kind public.asset_kind;
  v_storage_path text;
  v_mime_type text;
  v_byte_size bigint;
  v_width integer;
  v_height integer;
  v_duration numeric;
  v_existing_path text;
  v_cleanup_paths text[] := array[]::text[];
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
    raise exception 'ARTWORK_NOT_FOUND';
  end if;

  if jsonb_typeof(coalesce(p_assets, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_assets, '[]'::jsonb)) = 0 then
    raise exception 'ARTWORK_ASSETS_REQUIRED';
  end if;

  for v_asset in
    select value
    from jsonb_array_elements(p_assets)
  loop
    v_kind := (v_asset ->> 'kind')::public.asset_kind;
    v_storage_path := btrim(coalesce(v_asset ->> 'storage_path', ''));
    v_mime_type := btrim(coalesce(v_asset ->> 'mime_type', ''));
    v_byte_size := (v_asset ->> 'byte_size')::bigint;
    v_width := nullif(v_asset ->> 'width', '')::integer;
    v_height := nullif(v_asset ->> 'height', '')::integer;
    v_duration := nullif(v_asset ->> 'duration_seconds', '')::numeric;

    if v_storage_path = '' or v_mime_type = '' or coalesce(v_byte_size, 0) <= 0 then
      raise exception 'INVALID_ARTWORK_ASSET_PAYLOAD';
    end if;

    select storage_path
    into v_existing_path
    from public.artwork_assets
    where artwork_id = p_artwork_id
      and kind = v_kind
    for update;

    if v_existing_path is not null and v_existing_path <> v_storage_path then
      v_cleanup_paths := array_append(v_cleanup_paths, v_existing_path);
    end if;

    insert into public.artwork_assets (
      artwork_id,
      kind,
      storage_path,
      mime_type,
      byte_size,
      width,
      height,
      duration_seconds
    )
    values (
      p_artwork_id,
      v_kind,
      v_storage_path,
      v_mime_type,
      v_byte_size,
      v_width,
      v_height,
      v_duration
    )
    on conflict (artwork_id, kind)
    do update set
      storage_path = excluded.storage_path,
      mime_type = excluded.mime_type,
      byte_size = excluded.byte_size,
      width = excluded.width,
      height = excluded.height,
      duration_seconds = excluded.duration_seconds;
  end loop;

  v_cleanup_job_id := public.enqueue_media_cleanup_job(
    v_artwork.museum_id,
    auth.uid(),
    p_scope,
    to_jsonb(v_cleanup_paths)
  );

  return jsonb_build_object(
    'cleanupJobId', v_cleanup_job_id,
    'cleanupPaths', to_jsonb(coalesce(v_cleanup_paths, array[]::text[]))
  );
end;
$$;

create or replace function public.remove_artwork_audio_asset(p_artwork_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artwork public.artworks%rowtype;
  v_existing_path text;
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
    raise exception 'ARTWORK_NOT_FOUND';
  end if;

  select storage_path
  into v_existing_path
  from public.artwork_assets
  where artwork_id = p_artwork_id
    and kind = 'audio'
  for update;

  delete from public.artwork_assets
  where artwork_id = p_artwork_id
    and kind = 'audio';

  v_cleanup_job_id := public.enqueue_media_cleanup_job(
    v_artwork.museum_id,
    auth.uid(),
    'artwork.audio.remove',
    to_jsonb(case
      when v_existing_path is null then array[]::text[]
      else array[v_existing_path]
    end)
  );

  return jsonb_build_object(
    'cleanupJobId', v_cleanup_job_id,
    'removedPaths', to_jsonb(case
      when v_existing_path is null then array[]::text[]
      else array[v_existing_path]
    end)
  );
end;
$$;

drop function if exists public.delete_artwork(uuid);

create function public.delete_artwork(p_artwork_id uuid)
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

  select coalesce(array_agg(storage_path), array[]::text[])
  into v_paths
  from public.artwork_assets
  where artwork_id = p_artwork_id;

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

  select coalesce(array_agg(aa.storage_path), array[]::text[])
  into v_paths
  from public.artworks a
  join public.artwork_assets aa on aa.artwork_id = a.id
  where a.museum_id = v_museum.id;

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
  set metadata = metadata || jsonb_build_object('cleanupJobId', v_cleanup_job_id)
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
