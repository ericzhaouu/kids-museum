drop policy if exists "owners write audit events"
on public.audit_events;

create policy "owners write audit events"
on public.audit_events for insert
with check (
  actor_id = auth.uid()
  and exists (
    select 1
    from public.museum_profiles m
    where m.id = audit_events.museum_id
      and m.owner_id = auth.uid()
  )
);

update public.exhibitions e
set status = 'draft',
    published_at = null
where e.status = 'published'
  and (
    (
      select count(*)
      from public.exhibition_rooms r
      where r.exhibition_id = e.id
    ) < 2
    or exists (
      select 1
      from public.exhibition_rooms r
      where r.exhibition_id = e.id
        and not exists (
          select 1
          from public.room_artworks ra
          where ra.room_id = r.id
        )
    )
    or exists (
      select 1
      from public.exhibition_rooms r
      join public.room_artworks ra on ra.room_id = r.id
      join public.artworks a on a.id = ra.artwork_id
      where r.exhibition_id = e.id
        and a.status <> 'published'
    )
  );

create or replace function public.archive_exhibition(p_exhibition_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_museum_id uuid;
  v_version integer;
begin
  select e.museum_id, e.curation_version
  into v_museum_id, v_version
  from public.exhibitions e
  join public.museum_profiles m on m.id = e.museum_id
  where e.id = p_exhibition_id
    and m.owner_id = auth.uid()
  for update of e;

  if not found then
    return false;
  end if;

  update public.exhibitions
  set status = 'archived',
      published_at = null,
      archived_at = coalesce(archived_at, now()),
      curation_version = curation_version + 1
  where id = p_exhibition_id;

  update public.exhibition_ai_suggestions
  set status = 'stale',
      reviewed_at = coalesce(reviewed_at, now())
  where exhibition_id = p_exhibition_id
    and status = 'pending';

  insert into public.audit_events (
    museum_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values (
    v_museum_id,
    auth.uid(),
    'exhibition.archived',
    'exhibition',
    p_exhibition_id,
    jsonb_build_object('previousVersion', v_version)
  );

  return true;
end;
$$;

create or replace function public.delete_exhibition(p_exhibition_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_museum_id uuid;
  v_status public.exhibition_status;
  v_version integer;
begin
  select e.museum_id, e.status, e.curation_version
  into v_museum_id, v_status, v_version
  from public.exhibitions e
  join public.museum_profiles m on m.id = e.museum_id
  where e.id = p_exhibition_id
    and m.owner_id = auth.uid()
  for update of e;

  if not found then
    return false;
  end if;
  if v_status = 'published' then
    raise exception 'PUBLISHED_EXHIBITION_DELETE_FORBIDDEN';
  end if;

  insert into public.audit_events (
    museum_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values (
    v_museum_id,
    auth.uid(),
    'exhibition.deleted',
    'exhibition',
    p_exhibition_id,
    jsonb_build_object(
      'previousStatus', v_status,
      'previousVersion', v_version
    )
  );

  delete from public.exhibitions
  where id = p_exhibition_id;

  return true;
end;
$$;

create or replace function public.review_exhibition_ai_suggestion(
  p_suggestion_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_suggestion public.exhibition_ai_suggestions%rowtype;
  v_current_version integer;
  v_value text;
  v_next_version integer;
  v_status text;
begin
  if p_action not in ('accept', 'reject') then
    raise exception 'INVALID_REVIEW_ACTION';
  end if;

  select s.*
  into v_suggestion
  from public.exhibition_ai_suggestions s
  where s.id = p_suggestion_id
    and exists (
      select 1
      from public.exhibitions e
      join public.museum_profiles m on m.id = e.museum_id
      where e.id = s.exhibition_id
        and m.owner_id = auth.uid()
    )
  for update of s;

  if not found then
    raise exception 'SUGGESTION_NOT_FOUND';
  end if;

  select e.curation_version
  into v_current_version
  from public.exhibitions e
  join public.museum_profiles m on m.id = e.museum_id
  where e.id = v_suggestion.exhibition_id
    and m.owner_id = auth.uid()
  for update of e;

  if not found then
    raise exception 'SUGGESTION_NOT_FOUND';
  end if;
  if v_suggestion.status <> 'pending' then
    raise exception 'SUGGESTION_NOT_PENDING';
  end if;

  if v_suggestion.input_version <> v_current_version then
    update public.exhibition_ai_suggestions
    set status = 'stale',
        reviewed_at = now()
    where id = p_suggestion_id
      and status = 'pending';

    return jsonb_build_object(
      'exhibitionId', v_suggestion.exhibition_id,
      'status', 'stale'
    );
  end if;

  if p_action = 'accept' then
    v_value := btrim(coalesce(v_suggestion.content ->> 'value', ''));
    if v_suggestion.suggestion_type = 'title' then
      if char_length(v_value) not between 1 and 100 then
        raise exception 'INVALID_SUGGESTION_CONTENT';
      end if;
      update public.exhibitions
      set title = v_value,
          curation_version = curation_version + 1
      where id = v_suggestion.exhibition_id
      returning curation_version into v_next_version;
    elsif v_suggestion.suggestion_type = 'introduction' then
      if char_length(v_value) not between 1 and 2000 then
        raise exception 'INVALID_SUGGESTION_CONTENT';
      end if;
      update public.exhibitions
      set introduction = v_value,
          curation_version = curation_version + 1
      where id = v_suggestion.exhibition_id
      returning curation_version into v_next_version;
    elsif v_suggestion.suggestion_type = 'room_introduction' then
      if char_length(v_value) not between 1 and 1000
         or v_suggestion.target_room_order is null then
        raise exception 'INVALID_SUGGESTION_CONTENT';
      end if;
      update public.exhibition_rooms
      set introduction = v_value
      where exhibition_id = v_suggestion.exhibition_id
        and sort_order = v_suggestion.target_room_order;
      if not found then
        raise exception 'SUGGESTION_ROOM_NOT_FOUND';
      end if;
      update public.exhibitions
      set curation_version = curation_version + 1
      where id = v_suggestion.exhibition_id
      returning curation_version into v_next_version;
    else
      raise exception 'UNSUPPORTED_SUGGESTION_TYPE';
    end if;

    update public.exhibition_ai_suggestions
    set input_version = v_next_version
    where exhibition_id = v_suggestion.exhibition_id
      and input_version = v_current_version
      and status = 'pending'
      and id <> p_suggestion_id;

    v_status := 'accepted';
  else
    v_next_version := v_current_version;
    v_status := 'rejected';
  end if;

  update public.exhibition_ai_suggestions
  set status = v_status,
      reviewed_at = now()
  where id = p_suggestion_id
    and status = 'pending';
  if not found then
    raise exception 'SUGGESTION_NOT_PENDING';
  end if;

  insert into public.audit_events (
    museum_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values (
    v_suggestion.museum_id,
    auth.uid(),
    'exhibition.ai_suggestion.' || v_status,
    'exhibition',
    v_suggestion.exhibition_id,
    jsonb_build_object(
      'suggestionId', p_suggestion_id,
      'suggestionType', v_suggestion.suggestion_type,
      'inputVersion', v_suggestion.input_version,
      'providerRequestId', v_suggestion.provider_request_id
    )
  );

  return jsonb_build_object(
    'exhibitionId', v_suggestion.exhibition_id,
    'status', v_status,
    'curationVersion', v_next_version
  );
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
  v_museum_id uuid;
begin
  select a.museum_id
  into v_museum_id
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

  insert into public.audit_events (
    museum_id, actor_id, event_type, entity_type, entity_id, metadata
  )
  values (
    v_museum_id,
    auth.uid(),
    'artwork.deleted',
    'artwork',
    p_artwork_id,
    jsonb_build_object('assetCount', cardinality(v_paths))
  );

  delete from public.artworks
  where id = p_artwork_id;

  return v_paths;
end;
$$;
