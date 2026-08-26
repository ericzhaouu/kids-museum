create or replace function public.review_ai_suggestion(
  p_suggestion_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_suggestion public.ai_suggestions%rowtype;
  v_museum_id uuid;
  v_source_version integer;
  v_value text;
  v_tag text;
  v_tag_id uuid;
  v_status public.suggestion_status;
begin
  if p_action not in ('accept', 'reject') then
    raise exception 'INVALID_REVIEW_ACTION';
  end if;

  select s.*
  into v_suggestion
  from public.ai_suggestions s
  where s.id = p_suggestion_id
    and exists (
      select 1
      from public.artworks a
      join public.museum_profiles m on m.id = a.museum_id
      where a.id = s.artwork_id
        and m.owner_id = auth.uid()
    )
  for update of s;

  if not found then
    raise exception 'SUGGESTION_NOT_FOUND';
  end if;

  select a.museum_id, a.source_version
  into v_museum_id, v_source_version
  from public.artworks a
  join public.museum_profiles m on m.id = a.museum_id
  where a.id = v_suggestion.artwork_id
    and m.owner_id = auth.uid()
  for update of a;

  if not found then
    raise exception 'SUGGESTION_NOT_FOUND';
  end if;

  if v_suggestion.status <> 'pending' then
    raise exception 'SUGGESTION_NOT_PENDING';
  end if;

  if v_suggestion.input_version <> v_source_version then
    update public.ai_suggestions
    set status = 'stale',
        reviewed_at = now()
    where id = p_suggestion_id
      and status = 'pending';

    return jsonb_build_object(
      'artworkId', v_suggestion.artwork_id,
      'status', 'stale'
    );
  end if;

  if p_action = 'accept' then
    if v_suggestion.suggestion_type = 'title' then
      v_value := btrim(coalesce(v_suggestion.content ->> 'value', ''));
      if char_length(v_value) not between 1 and 80 then
        raise exception 'INVALID_SUGGESTION_CONTENT';
      end if;
      update public.artworks set title = v_value where id = v_suggestion.artwork_id;
    elsif v_suggestion.suggestion_type = 'description' then
      v_value := btrim(coalesce(v_suggestion.content ->> 'value', ''));
      if char_length(v_value) not between 1 and 1000 then
        raise exception 'INVALID_SUGGESTION_CONTENT';
      end if;
      update public.artworks
      set description = v_value
      where id = v_suggestion.artwork_id;
    elsif v_suggestion.suggestion_type = 'transcript' then
      v_value := btrim(coalesce(v_suggestion.content ->> 'value', ''));
      if char_length(v_value) not between 1 and 2000 then
        raise exception 'INVALID_SUGGESTION_CONTENT';
      end if;
      insert into public.artwork_notes (
        artwork_id,
        source,
        content,
        is_ai_input
      )
      values (
        v_suggestion.artwork_id,
        'transcript',
        v_value,
        false
      )
      on conflict (artwork_id, source)
      do update set
        content = excluded.content,
        is_ai_input = false,
        updated_at = now();
    elsif v_suggestion.suggestion_type = 'tags' then
      if jsonb_typeof(v_suggestion.content -> 'values') <> 'array' then
        raise exception 'INVALID_SUGGESTION_CONTENT';
      end if;

      delete from public.artwork_tags
      where artwork_id = v_suggestion.artwork_id;

      for v_tag in
        select distinct btrim(value)
        from jsonb_array_elements_text(v_suggestion.content -> 'values')
        where char_length(btrim(value)) between 1 and 20
        limit 5
      loop
        insert into public.tags (museum_id, name)
        values (v_museum_id, v_tag)
        on conflict (museum_id, name)
        do update set name = excluded.name
        returning id into v_tag_id;

        insert into public.artwork_tags (artwork_id, tag_id)
        values (v_suggestion.artwork_id, v_tag_id)
        on conflict do nothing;
      end loop;
    else
      raise exception 'UNSUPPORTED_SUGGESTION_TYPE';
    end if;

    v_status := 'accepted';
  else
    v_status := 'rejected';
  end if;

  update public.ai_suggestions
  set status = v_status,
      reviewed_at = now()
  where id = p_suggestion_id
    and status = 'pending';

  if not found then
    raise exception 'SUGGESTION_NOT_PENDING';
  end if;

  insert into public.audit_events (
    museum_id,
    actor_id,
    event_type,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_museum_id,
    auth.uid(),
    'ai_suggestion.' || v_status::text,
    'artwork',
    v_suggestion.artwork_id,
    jsonb_build_object(
      'suggestionId', p_suggestion_id,
      'suggestionType', v_suggestion.suggestion_type,
      'inputVersion', v_suggestion.input_version,
      'providerRequestId', v_suggestion.provider_request_id
    )
  );

  return jsonb_build_object(
    'artworkId', v_suggestion.artwork_id,
    'status', v_status::text
  );
end;
$$;
