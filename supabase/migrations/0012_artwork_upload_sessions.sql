create table if not exists public.media_upload_sessions (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  museum_id uuid not null references public.museum_profiles(id) on delete cascade,
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  authorized_paths jsonb not null default '[]'::jsonb,
  descriptors jsonb not null default '[]'::jsonb,
  status text not null default 'authorized' check (
    status in ('authorized', 'committed', 'failed', 'cleanup_queued')
  ),
  expires_at timestamptz not null,
  committed_at timestamptz,
  cleanup_queued_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(authorized_paths) = 'array'),
  check (jsonb_typeof(descriptors) = 'array'),
  check (expires_at > created_at)
);

create index if not exists media_upload_sessions_status_idx
on public.media_upload_sessions (status, expires_at, created_at);

drop trigger if exists media_upload_sessions_set_updated_at
on public.media_upload_sessions;
create trigger media_upload_sessions_set_updated_at
before update on public.media_upload_sessions
for each row execute procedure public.set_updated_at();

alter table public.media_upload_sessions enable row level security;

drop policy if exists "owners inspect media upload sessions"
on public.media_upload_sessions;
create policy "owners inspect media upload sessions"
on public.media_upload_sessions for select
using (owner_id = auth.uid());

drop policy if exists "owners manage artwork assets" on public.artwork_assets;
create policy "owners read artwork assets"
on public.artwork_assets for select
using (
  exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = artwork_assets.artwork_id
      and m.owner_id = auth.uid()
      and left(
        artwork_assets.storage_path,
        char_length(a.museum_id::text || '/' || a.id::text || '/')
      ) = a.museum_id::text || '/' || a.id::text || '/'
      and char_length(artwork_assets.storage_path) >
        char_length(a.museum_id::text || '/' || a.id::text || '/')
  )
);

drop policy if exists "owners upload private museum objects" on storage.objects;
create policy "owners upload private museum objects"
on storage.objects for insert
with check (
  bucket_id = 'museum-private'
  and (storage.foldername(name))[3] = 'temp'
  and exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.museum_id::text = (storage.foldername(name))[1]
      and a.id::text = (storage.foldername(name))[2]
      and m.owner_id = auth.uid()
  )
);

drop policy if exists "owners update private museum objects" on storage.objects;
create policy "owners update private museum objects"
on storage.objects for update
using (
  bucket_id = 'museum-private'
  and (storage.foldername(name))[3] = 'temp'
  and exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.museum_id::text = (storage.foldername(name))[1]
      and a.id::text = (storage.foldername(name))[2]
      and m.owner_id = auth.uid()
  )
)
with check (
  bucket_id = 'museum-private'
  and (storage.foldername(name))[3] = 'temp'
  and exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.museum_id::text = (storage.foldername(name))[1]
      and a.id::text = (storage.foldername(name))[2]
      and m.owner_id = auth.uid()
  )
);

drop policy if exists "owners delete private museum objects" on storage.objects;
create policy "owners delete private museum objects"
on storage.objects for delete
using (
  bucket_id = 'museum-private'
  and (storage.foldername(name))[3] = 'temp'
  and exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.museum_id::text = (storage.foldername(name))[1]
      and a.id::text = (storage.foldername(name))[2]
      and m.owner_id = auth.uid()
  )
);

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
  if auth.role() = 'service_role' then
    if p_owner_id is null then
      raise exception 'MEDIA_CLEANUP_FORBIDDEN';
    end if;
  elsif auth.uid() is null or p_owner_id <> auth.uid() then
    raise exception 'MEDIA_CLEANUP_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.museum_profiles m
    where m.id = p_museum_id
      and m.owner_id = p_owner_id
  ) and not exists (
    select 1
    from public.museum_tombstones t
    where t.museum_id = p_museum_id
      and t.owner_id = p_owner_id
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

create or replace function public.artwork_asset_extension_for_mime_type(
  p_mime_type text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  case p_mime_type
    when 'image/webp' then
      return 'webp';
    when 'audio/mpeg' then
      return 'mp3';
    when 'audio/mp4' then
      return 'm4a';
    when 'audio/webm' then
      return 'webm';
    when 'audio/ogg' then
      return 'ogg';
    when 'audio/wav' then
      return 'wav';
    else
      raise exception 'INVALID_ARTWORK_ASSET_MIME';
  end case;
end;
$$;

create or replace function public.assert_final_artwork_asset_object(
  p_museum_id uuid,
  p_artwork_id uuid,
  p_kind public.asset_kind,
  p_storage_path text,
  p_mime_type text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_segments text[];
  v_file_name text;
begin
  if btrim(coalesce(p_storage_path, '')) = ''
     or p_storage_path like '%\%'
     or p_storage_path like '%..%' then
    raise exception 'INVALID_ARTWORK_ASSET_PATH';
  end if;

  v_segments := string_to_array(p_storage_path, '/');
  if coalesce(array_length(v_segments, 1), 0) <> 4
     or v_segments[1] <> p_museum_id::text
     or v_segments[2] <> p_artwork_id::text
     or v_segments[3] = 'temp' then
    raise exception 'INVALID_ARTWORK_ASSET_PATH';
  end if;

  v_file_name := v_segments[4];
  if split_part(v_file_name, '.', 1) <> p_kind::text
     or split_part(v_file_name, '.', 2) <>
       public.artwork_asset_extension_for_mime_type(p_mime_type) then
    raise exception 'INVALID_ARTWORK_ASSET_PATH';
  end if;

  if p_kind <> 'audio' and p_mime_type <> 'image/webp' then
    raise exception 'INVALID_ARTWORK_ASSET_MIME';
  end if;

  if p_kind = 'audio'
     and p_mime_type not in (
       'audio/webm',
       'audio/mpeg',
       'audio/mp4',
       'audio/wav',
       'audio/ogg'
     ) then
    raise exception 'INVALID_ARTWORK_ASSET_MIME';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'museum-private'
      and o.name = p_storage_path
      and coalesce(o.metadata ->> 'mimetype', '') = p_mime_type
  ) then
    raise exception 'ARTWORK_ASSET_OBJECT_NOT_FOUND';
  end if;
end;
$$;

create or replace function public.create_artwork_draft(
  p_museum_id uuid,
  p_owner_id uuid,
  p_title text,
  p_description text,
  p_created_on date,
  p_age_label text,
  p_medium text,
  p_child_quote text,
  p_parent_note text
)
returns table (id uuid, museum_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artwork public.artworks%rowtype;
begin
  if auth.uid() is null or p_owner_id <> auth.uid() then
    raise exception 'ARTWORK_DRAFT_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.museum_profiles m
    where m.id = p_museum_id
      and m.owner_id = auth.uid()
  ) then
    raise exception 'MUSEUM_NOT_FOUND';
  end if;

  insert into public.artworks (
    museum_id,
    title,
    description,
    created_on,
    age_label,
    medium,
    status
  )
  values (
    p_museum_id,
    p_title,
    p_description,
    p_created_on,
    p_age_label,
    p_medium,
    'draft'
  )
  returning * into v_artwork;

  if btrim(coalesce(p_child_quote, '')) <> '' then
    insert into public.artwork_notes (
      artwork_id,
      source,
      content,
      is_ai_input
    )
    values (v_artwork.id, 'child', p_child_quote, true);
  end if;

  if btrim(coalesce(p_parent_note, '')) <> '' then
    insert into public.artwork_notes (
      artwork_id,
      source,
      content,
      is_ai_input
    )
    values (v_artwork.id, 'parent', p_parent_note, false);
  end if;

  return query
  select v_artwork.id, v_artwork.museum_id;
end;
$$;

revoke all on function public.create_artwork_draft(
  uuid,
  uuid,
  text,
  text,
  date,
  text,
  text,
  text,
  text
) from public, anon;
grant execute on function public.create_artwork_draft(
  uuid,
  uuid,
  text,
  text,
  date,
  text,
  text,
  text,
  text
) to authenticated;

revoke all on function public.replace_artwork_assets(
  uuid,
  jsonb,
  text
) from public, anon, authenticated, service_role;

revoke all on function public.remove_artwork_audio_asset(uuid)
from public, anon, authenticated, service_role;

revoke all on function public.apply_artwork_update(
  uuid,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  public.artwork_status,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  jsonb,
  boolean,
  boolean
) from public, anon, authenticated, service_role;

create or replace function public.apply_artwork_update_server(
  p_owner_id uuid,
  p_artwork_id uuid,
  p_title text,
  p_description text,
  p_created_on date,
  p_age_label text,
  p_medium text,
  p_child_quote text,
  p_parent_note text,
  p_status public.artwork_status,
  p_update_title boolean default false,
  p_update_description boolean default false,
  p_update_created_on boolean default false,
  p_update_age_label boolean default false,
  p_update_medium boolean default false,
  p_update_child_quote boolean default false,
  p_update_parent_note boolean default false,
  p_update_status boolean default false,
  p_assets jsonb default null,
  p_remove_audio boolean default false,
  p_bump_source_version boolean default false
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
  v_source_version integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'ARTWORK_UPDATE_SERVER_FORBIDDEN';
  end if;

  select a.*
  into v_artwork
  from public.artworks a
  join public.museum_profiles m on m.id = a.museum_id
  where a.id = p_artwork_id
    and m.owner_id = p_owner_id
  for update of a;

  if not found then
    raise exception 'ARTWORK_NOT_FOUND';
  end if;

  if p_remove_audio
     and p_assets is not null
     and exists (
       select 1
       from jsonb_array_elements(p_assets) as asset(value)
       where asset.value ->> 'kind' = 'audio'
     ) then
    raise exception 'CONFLICTING_AUDIO_UPDATE';
  end if;

  if p_assets is not null and (
    jsonb_typeof(p_assets) <> 'array'
    or jsonb_array_length(p_assets) = 0
  ) then
    raise exception 'ARTWORK_ASSETS_REQUIRED';
  end if;

  if p_update_status and p_status <> 'published' then
    delete from public.room_artworks ra
    using public.exhibition_rooms r, public.exhibitions e
    where ra.artwork_id = p_artwork_id
      and r.id = ra.room_id
      and e.id = r.exhibition_id
      and e.status = 'published';
  end if;

  update public.artworks
  set
    title = case when p_update_title then p_title else title end,
    description = case when p_update_description then p_description else description end,
    created_on = case when p_update_created_on then p_created_on else created_on end,
    age_label = case when p_update_age_label then p_age_label else age_label end,
    medium = case when p_update_medium then p_medium else medium end,
    status = case when p_update_status then p_status else status end
  where id = p_artwork_id;

  if p_update_child_quote then
    if btrim(coalesce(p_child_quote, '')) = '' then
      delete from public.artwork_notes
      where artwork_id = p_artwork_id
        and source = 'child';
    else
      insert into public.artwork_notes (
        artwork_id,
        source,
        content,
        is_ai_input
      )
      values (p_artwork_id, 'child', p_child_quote, true)
      on conflict (artwork_id, source)
      do update set
        content = excluded.content,
        is_ai_input = excluded.is_ai_input;
    end if;
  end if;

  if p_update_parent_note then
    if btrim(coalesce(p_parent_note, '')) = '' then
      delete from public.artwork_notes
      where artwork_id = p_artwork_id
        and source = 'parent';
    else
      insert into public.artwork_notes (
        artwork_id,
        source,
        content,
        is_ai_input
      )
      values (p_artwork_id, 'parent', p_parent_note, false)
      on conflict (artwork_id, source)
      do update set
        content = excluded.content,
        is_ai_input = excluded.is_ai_input;
    end if;
  end if;

  if p_assets is not null then
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

      perform public.assert_final_artwork_asset_object(
        v_artwork.museum_id,
        p_artwork_id,
        v_kind,
        v_storage_path,
        v_mime_type
      );

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
  end if;

  if p_remove_audio then
    select storage_path
    into v_existing_path
    from public.artwork_assets
    where artwork_id = p_artwork_id
      and kind = 'audio'
    for update;

    if v_existing_path is not null then
      v_cleanup_paths := array_append(v_cleanup_paths, v_existing_path);
    end if;

    delete from public.artwork_assets
    where artwork_id = p_artwork_id
      and kind = 'audio';
  end if;

  if p_bump_source_version then
    update public.ai_suggestions
    set status = 'stale',
        reviewed_at = coalesce(reviewed_at, now())
    where artwork_id = p_artwork_id
      and status = 'pending';

    update public.artworks
    set source_version = source_version + 1
    where id = p_artwork_id
    returning source_version into v_source_version;
  else
    v_source_version := v_artwork.source_version;
  end if;

  v_cleanup_job_id := public.enqueue_media_cleanup_job(
    v_artwork.museum_id,
    p_owner_id,
    'artwork.asset.replace',
    to_jsonb(v_cleanup_paths)
  );

  return jsonb_build_object(
    'cleanupJobId', v_cleanup_job_id,
    'cleanupPaths', to_jsonb(coalesce(v_cleanup_paths, array[]::text[])),
    'removedPaths', to_jsonb(coalesce(v_cleanup_paths, array[]::text[])),
    'sourceVersion', v_source_version
  );
end;
$$;

revoke all on function public.apply_artwork_update_server(
  uuid,
  uuid,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  public.artwork_status,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  jsonb,
  boolean,
  boolean
) from public, anon, authenticated;
grant execute on function public.apply_artwork_update_server(
  uuid,
  uuid,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  public.artwork_status,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  jsonb,
  boolean,
  boolean
) to service_role;

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
    where s.status in ('authorized', 'failed')
      and s.expires_at <= now()
    order by s.expires_at, s.id
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  ), updated as (
    update public.media_upload_sessions s
    set status = 'cleanup_queued',
        cleanup_queued_at = now(),
        last_error = coalesce(s.last_error, 'MEDIA_UPLOAD_SESSION_EXPIRED')
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
    'artwork.upload.session.expired',
    u.authorized_paths
  from updated u
  where jsonb_array_length(u.authorized_paths) > 0;

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

revoke all on function public.queue_expired_media_upload_session_cleanups(integer)
from public, anon, authenticated;
grant execute on function public.queue_expired_media_upload_session_cleanups(integer)
to service_role;
