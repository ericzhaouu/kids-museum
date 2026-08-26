alter table public.exhibitions
add column if not exists curation_version integer not null default 1
check (curation_version > 0),
add column if not exists archived_at timestamptz;

create or replace function public.normalize_room_artwork_display_config(p_config jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_config jsonb := coalesce(p_config, '{}'::jsonb);
  v_key text;
  v_featured boolean := false;
  v_size text := 'medium';
  v_frame_preset text := 'classic';
begin
  if jsonb_typeof(v_config) <> 'object' then
    raise exception 'INVALID_DISPLAY_CONFIG';
  end if;

  for v_key in select jsonb_object_keys(v_config)
  loop
    if v_key not in ('featured', 'size', 'framePreset') then
      raise exception 'INVALID_DISPLAY_CONFIG';
    end if;
  end loop;

  if v_config ? 'featured' then
    if jsonb_typeof(v_config -> 'featured') <> 'boolean' then
      raise exception 'INVALID_DISPLAY_CONFIG';
    end if;
    v_featured := (v_config ->> 'featured')::boolean;
  end if;

  if v_config ? 'size' then
    if (v_config ->> 'size') not in ('small', 'medium', 'large') then
      raise exception 'INVALID_DISPLAY_CONFIG';
    end if;
    v_size := v_config ->> 'size';
  end if;

  if v_config ? 'framePreset' then
    if (v_config ->> 'framePreset') not in ('classic', 'shadow', 'float', 'storybook') then
      raise exception 'INVALID_DISPLAY_CONFIG';
    end if;
    v_frame_preset := v_config ->> 'framePreset';
  end if;

  return jsonb_build_object(
    'featured', v_featured,
    'size', v_size,
    'framePreset', v_frame_preset
  );
end;
$$;

create table if not exists public.exhibition_ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  exhibition_id uuid not null,
  museum_id uuid not null,
  suggestion_type text not null check (
    suggestion_type in ('title', 'introduction', 'room_introduction')
  ),
  target_room_order integer check (target_room_order is null or target_room_order >= 0),
  input_version integer not null check (input_version > 0),
  content jsonb not null,
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'rejected', 'stale')
  ),
  provider_request_id text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint exhibition_ai_suggestions_exhibition_museum_fk
    foreign key (exhibition_id, museum_id)
    references public.exhibitions (id, museum_id)
    on delete cascade
);

create index if not exists exhibition_ai_suggestions_exhibition_status_idx
on public.exhibition_ai_suggestions (exhibition_id, status, input_version, created_at desc);

alter table public.exhibition_ai_suggestions enable row level security;

drop policy if exists "owners manage exhibition ai suggestions"
on public.exhibition_ai_suggestions;
create policy "owners manage exhibition ai suggestions"
on public.exhibition_ai_suggestions for all
using (
  exists (
    select 1
    from public.museum_profiles m
    where m.id = exhibition_ai_suggestions.museum_id
      and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.museum_profiles m
    where m.id = exhibition_ai_suggestions.museum_id
      and m.owner_id = auth.uid()
  )
);

create or replace function public.stale_exhibition_ai_suggestions(
  p_exhibition_id uuid,
  p_reviewed_at timestamptz default now()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if not exists (
    select 1
    from public.exhibitions e
    join public.museum_profiles m on m.id = e.museum_id
    where e.id = p_exhibition_id
      and m.owner_id = auth.uid()
  ) then
    raise exception 'EXHIBITION_NOT_FOUND';
  end if;

  update public.exhibition_ai_suggestions
  set status = 'stale',
      reviewed_at = coalesce(reviewed_at, p_reviewed_at)
  where exhibition_id = p_exhibition_id
    and status = 'pending';

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.save_exhibition_curation(
  p_exhibition_id uuid,
  p_title text,
  p_subtitle text,
  p_introduction text,
  p_status public.exhibition_status,
  p_theme_id text,
  p_rooms jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_museum_id uuid;
  v_exhibition_id uuid;
  v_previous_status public.exhibition_status;
  v_previous_theme_id text;
  v_previous_theme_version integer;
  v_previous_curation_version integer;
  v_next_theme_version integer;
  v_next_curation_version integer;
  v_room jsonb;
  v_room_id uuid;
  v_room_payload jsonb;
  v_artwork_payload jsonb;
  v_room_index integer;
  v_artwork_index integer;
  v_artwork_id uuid;
  v_display_config jsonb;
  v_artwork_status public.artwork_status;
begin
  select id
  into v_museum_id
  from public.museum_profiles
  where owner_id = auth.uid();

  if v_museum_id is null then
    raise exception 'MUSEUM_NOT_FOUND';
  end if;

  if jsonb_typeof(coalesce(p_rooms, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_rooms, '[]'::jsonb)) = 0 then
    raise exception 'ROOMS_REQUIRED';
  end if;

  if p_status = 'published' then
    if jsonb_array_length(p_rooms) < 2 then
      raise exception 'PUBLISH_ROOM_MINIMUM';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_rooms) as room
      where jsonb_array_length(coalesce(room -> 'artworks', '[]'::jsonb)) = 0
    ) then
      raise exception 'PUBLISH_ROOM_EMPTY';
    end if;
  end if;

  if p_exhibition_id is null then
    insert into public.exhibitions (
      museum_id,
      title,
      subtitle,
      introduction,
      status,
      theme_id,
      theme_version,
      curation_version,
      published_at,
      archived_at
    )
    values (
      v_museum_id,
      p_title,
      p_subtitle,
      p_introduction,
      case when p_status = 'published' then 'draft' else p_status end,
      p_theme_id,
      1,
      1,
      null,
      case when p_status = 'archived' then now() else null end
    )
    returning id, status, theme_id, theme_version, curation_version
    into v_exhibition_id, v_previous_status, v_previous_theme_id, v_previous_theme_version, v_previous_curation_version;
  else
    select status, theme_id, theme_version, curation_version
    into v_previous_status, v_previous_theme_id, v_previous_theme_version, v_previous_curation_version
    from public.exhibitions
    where id = p_exhibition_id
      and museum_id = v_museum_id
    for update;

    if v_previous_status is null then
      raise exception 'EXHIBITION_NOT_FOUND';
    end if;

    v_next_theme_version := case
      when v_previous_theme_id = p_theme_id then v_previous_theme_version
      else v_previous_theme_version + 1
    end;
    v_next_curation_version := v_previous_curation_version + 1;

    update public.exhibitions
    set
      title = p_title,
      subtitle = p_subtitle,
      introduction = p_introduction,
      status = case when p_status = 'published' then 'draft' else p_status end,
      theme_id = p_theme_id,
      theme_version = v_next_theme_version,
      curation_version = v_next_curation_version,
      published_at = null,
      archived_at = case when p_status = 'archived' then now() else null end
    where id = p_exhibition_id
      and museum_id = v_museum_id
    returning id
    into v_exhibition_id;

    delete from public.exhibition_rooms
    where exhibition_id = v_exhibition_id;

    update public.exhibition_ai_suggestions
    set status = 'stale',
        reviewed_at = coalesce(reviewed_at, now())
    where exhibition_id = v_exhibition_id
      and status = 'pending';
  end if;

  for v_room, v_room_index in
    select value, ordinality - 1
    from jsonb_array_elements(p_rooms) with ordinality
  loop
    if jsonb_typeof(coalesce(v_room -> 'artworks', '[]'::jsonb)) <> 'array' then
      raise exception 'ROOM_ARTWORKS_INVALID';
    end if;

    insert into public.exhibition_rooms (
      exhibition_id,
      museum_id,
      name,
      subtitle,
      introduction,
      sort_order,
      room_style
    )
    values (
      v_exhibition_id,
      v_museum_id,
      btrim(coalesce(v_room ->> 'name', '')),
      btrim(coalesce(v_room ->> 'subtitle', '')),
      btrim(coalesce(v_room ->> 'introduction', '')),
      v_room_index,
      '{}'::jsonb
    )
    returning id into v_room_id;

    for v_artwork_payload, v_artwork_index in
      select value, ordinality - 1
      from jsonb_array_elements(coalesce(v_room -> 'artworks', '[]'::jsonb)) with ordinality
    loop
      v_artwork_id := (v_artwork_payload ->> 'artworkId')::uuid;
      v_display_config := public.normalize_room_artwork_display_config(
        v_artwork_payload -> 'displayConfig'
      );

      select status
      into v_artwork_status
      from public.artworks
      where id = v_artwork_id
        and museum_id = v_museum_id;

      if v_artwork_status is null then
        raise exception 'ARTWORK_NOT_FOUND';
      end if;

      if v_artwork_status = 'archived' then
        raise exception 'ARCHIVED_ARTWORK_NOT_ALLOWED';
      end if;

      if p_status = 'published' and v_artwork_status <> 'published' then
        raise exception 'PUBLISHED_ARTWORK_NOT_FOUND';
      end if;

      insert into public.room_artworks (
        room_id,
        artwork_id,
        museum_id,
        sort_order,
        display_config
      )
      values (
        v_room_id,
        v_artwork_id,
        v_museum_id,
        v_artwork_index,
        v_display_config
      );
    end loop;
  end loop;

  update public.exhibitions
  set
    status = p_status,
    published_at = case when p_status = 'published' then now() else null end,
    archived_at = case when p_status = 'archived' then coalesce(archived_at, now()) else null end
  where id = v_exhibition_id;

  return v_exhibition_id;
end;
$$;
