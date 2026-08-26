drop policy if exists "owners revoke visitor sessions"
on public.visitor_sessions;

create policy "owners revoke visitor sessions"
on public.visitor_sessions for update
using (
  exists (
    select 1
    from public.invitations i
    join public.museum_profiles m on m.id = i.museum_id
    where i.id = invitation_id
      and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.invitations i
    join public.museum_profiles m on m.id = i.museum_id
    where i.id = invitation_id
      and m.owner_id = auth.uid()
  )
);

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_revoked_at timestamptz := now();
begin
  if not exists (
    select 1
    from public.invitations i
    join public.museum_profiles m on m.id = i.museum_id
    where i.id = p_invitation_id
      and m.owner_id = auth.uid()
  ) then
    return false;
  end if;

  update public.invitations
  set revoked_at = coalesce(revoked_at, v_revoked_at)
  where id = p_invitation_id;

  update public.visitor_sessions
  set revoked_at = coalesce(revoked_at, v_revoked_at)
  where invitation_id = p_invitation_id;

  return true;
end;
$$;

create or replace function public.update_artwork(
  p_artwork_id uuid,
  p_title text,
  p_description text,
  p_created_on date,
  p_age_label text,
  p_medium text,
  p_child_quote text,
  p_parent_note text,
  p_status public.artwork_status,
  p_update_title boolean,
  p_update_description boolean,
  p_update_created_on boolean,
  p_update_age_label boolean,
  p_update_medium boolean,
  p_update_child_quote boolean,
  p_update_parent_note boolean,
  p_update_status boolean
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = p_artwork_id
      and m.owner_id = auth.uid()
  ) then
    return false;
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
    description = case
      when p_update_description then p_description
      else description
    end,
    created_on = case
      when p_update_created_on then p_created_on
      else created_on
    end,
    age_label = case
      when p_update_age_label then p_age_label
      else age_label
    end,
    medium = case when p_update_medium then p_medium else medium end,
    status = case when p_update_status then p_status else status end
  where id = p_artwork_id;

  if p_update_child_quote then
    if btrim(coalesce(p_child_quote, '')) = '' then
      delete from public.artwork_notes
      where artwork_id = p_artwork_id
        and source = 'child';
    else
      update public.artwork_notes
      set content = p_child_quote, is_ai_input = true
      where artwork_id = p_artwork_id
        and source = 'child';

      if not found then
        insert into public.artwork_notes (
          artwork_id,
          source,
          content,
          is_ai_input
        )
        values (p_artwork_id, 'child', p_child_quote, true);
      end if;
    end if;
  end if;

  if p_update_parent_note then
    if btrim(coalesce(p_parent_note, '')) = '' then
      delete from public.artwork_notes
      where artwork_id = p_artwork_id
        and source = 'parent';
    else
      update public.artwork_notes
      set content = p_parent_note, is_ai_input = false
      where artwork_id = p_artwork_id
        and source = 'parent';

      if not found then
        insert into public.artwork_notes (
          artwork_id,
          source,
          content,
          is_ai_input
        )
        values (p_artwork_id, 'parent', p_parent_note, false);
      end if;
    end if;
  end if;

  return true;
end;
$$;

create or replace function public.delete_artwork(p_artwork_id uuid)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_paths text[];
begin
  if not exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = p_artwork_id
      and m.owner_id = auth.uid()
  ) then
    return null;
  end if;

  select coalesce(array_agg(storage_path), array[]::text[])
  into v_paths
  from public.artwork_assets
  where artwork_id = p_artwork_id;

  delete from public.artworks
  where id = p_artwork_id;

  return v_paths;
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
  v_published_at timestamptz;
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
      'draft',
      p_theme_id,
      1,
      null
    )
    returning id into v_exhibition_id;
  else
    select published_at
    into v_published_at
    from public.exhibitions
    where id = p_exhibition_id
      and museum_id = v_museum_id;

    update public.exhibitions
    set
      title = p_title,
      subtitle = p_subtitle,
      introduction = p_introduction,
      status = 'draft',
      theme_id = p_theme_id,
      published_at = null
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
          and status = 'published'
      ) then
        raise exception 'PUBLISHED_ARTWORK_NOT_FOUND';
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

  update public.exhibitions
  set
    status = p_status,
    published_at = case
      when p_status = 'published' then coalesce(v_published_at, now())
      else null
    end
  where id = v_exhibition_id;

  return v_exhibition_id;
end;
$$;
