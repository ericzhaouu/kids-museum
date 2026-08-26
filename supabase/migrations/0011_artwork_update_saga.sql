create or replace function public.apply_artwork_update(
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
      if left(
        v_storage_path,
        char_length(v_artwork.museum_id::text || '/' || p_artwork_id::text || '/')
      ) <> v_artwork.museum_id::text || '/' || p_artwork_id::text || '/' then
        raise exception 'INVALID_ARTWORK_ASSET_PATH';
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
    auth.uid(),
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
) from public, anon;

grant execute on function public.apply_artwork_update(
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
) to authenticated;
