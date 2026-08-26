alter table public.exhibition_rooms
add column if not exists subtitle text not null default '' check (char_length(subtitle) <= 150);

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
set search_path = public
as $$
declare
  v_museum_id uuid;
  v_exhibition_id uuid;
  v_room jsonb;
  v_room_id uuid;
  v_artwork_id uuid;
  v_room_index integer;
  v_artwork_index integer;
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

  if p_exhibition_id is null then
    insert into public.exhibitions (
      museum_id,
      title,
      subtitle,
      introduction,
      status,
      theme_id,
      theme_version,
      published_at
    )
    values (
      v_museum_id,
      p_title,
      p_subtitle,
      p_introduction,
      p_status,
      p_theme_id,
      1,
      case when p_status = 'published' then now() else null end
    )
    returning id into v_exhibition_id;
  else
    update public.exhibitions
    set
      title = p_title,
      subtitle = p_subtitle,
      introduction = p_introduction,
      status = p_status,
      theme_id = p_theme_id,
      published_at = case
        when p_status = 'published' then coalesce(published_at, now())
        else null
      end
    where id = p_exhibition_id
      and museum_id = v_museum_id
    returning id into v_exhibition_id;

    if v_exhibition_id is null then
      raise exception 'EXHIBITION_NOT_FOUND';
    end if;

    delete from public.exhibition_rooms
    where exhibition_id = v_exhibition_id;
  end if;

  for v_room, v_room_index in
    select value, ordinality - 1
    from jsonb_array_elements(p_rooms) with ordinality
  loop
    insert into public.exhibition_rooms (
      exhibition_id,
      name,
      subtitle,
      introduction,
      sort_order,
      room_style
    )
    values (
      v_exhibition_id,
      btrim(coalesce(v_room->>'name', '')),
      btrim(coalesce(v_room->>'subtitle', '')),
      btrim(coalesce(v_room->>'introduction', '')),
      v_room_index,
      '{}'::jsonb
    )
    returning id into v_room_id;

    for v_artwork_id, v_artwork_index in
      select value::uuid, ordinality - 1
      from jsonb_array_elements_text(coalesce(v_room->'artworkIds', '[]'::jsonb))
        with ordinality
    loop
      if not exists (
        select 1
        from public.artworks
        where id = v_artwork_id
          and museum_id = v_museum_id
      ) then
        raise exception 'ARTWORK_NOT_FOUND';
      end if;

      insert into public.room_artworks (
        room_id,
        artwork_id,
        sort_order,
        display_config
      )
      values (
        v_room_id,
        v_artwork_id,
        v_artwork_index,
        '{}'::jsonb
      );
    end loop;
  end loop;

  return v_exhibition_id;
end;
$$;
