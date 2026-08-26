create or replace function public.export_museum_backup_metadata()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_museum public.museum_profiles%rowtype;
begin
  select m.*
  into v_museum
  from public.museum_profiles m
  where m.owner_id = auth.uid();

  if not found then
    raise exception 'MUSEUM_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'museum', jsonb_build_object(
      'id', v_museum.id,
      'name', v_museum.name,
      'artist_nickname', v_museum.artist_nickname,
      'theme_id', v_museum.theme_id,
      'theme_version', v_museum.theme_version,
      'created_at', v_museum.created_at,
      'updated_at', v_museum.updated_at
    ),
    'artworks', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
      from (
        select
          a.id, a.museum_id, a.title, a.description, a.status,
          a.created_on, a.age_label, a.medium, a.source_version,
          a.created_at, a.updated_at
        from public.artworks a
        where a.museum_id = v_museum.id
      ) item
    ),
    'artworkAssets', (
      select coalesce(
        jsonb_agg(to_jsonb(item) order by item.artwork_id, item.kind),
        '[]'::jsonb
      )
      from (
        select
          aa.artwork_id, aa.kind, aa.storage_path, aa.mime_type,
          aa.byte_size, aa.width, aa.height, aa.duration_seconds,
          aa.created_at
        from public.artwork_assets aa
        join public.artworks a on a.id = aa.artwork_id
        where a.museum_id = v_museum.id
      ) item
    ),
    'artworkNotes', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
      from (
        select
          n.id, n.artwork_id, n.source, n.content, n.is_ai_input,
          n.created_at, n.updated_at
        from public.artwork_notes n
        join public.artworks a on a.id = n.artwork_id
        where a.museum_id = v_museum.id
      ) item
    ),
    'tagCatalog', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
      from (
        select t.id, t.museum_id, t.name
        from public.tags t
        where t.museum_id = v_museum.id
      ) item
    ),
    'artworkTags', (
      select coalesce(
        jsonb_agg(to_jsonb(item) order by item.artwork_id, item.tag_id),
        '[]'::jsonb
      )
      from (
        select
          at.artwork_id,
          at.tag_id,
          jsonb_build_object(
            'id', t.id,
            'museum_id', t.museum_id,
            'name', t.name
          ) as tag
        from public.artwork_tags at
        join public.artworks a on a.id = at.artwork_id
        join public.tags t on t.id = at.tag_id
        where a.museum_id = v_museum.id
      ) item
    ),
    'aiSuggestions', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
      from (
        select
          s.id, s.artwork_id, s.suggestion_type, s.input_version,
          s.content, s.status, s.provider_request_id,
          s.created_at, s.reviewed_at
        from public.ai_suggestions s
        join public.artworks a on a.id = s.artwork_id
        where a.museum_id = v_museum.id
      ) item
    ),
    'exhibitions', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
      from (
        select
          e.id, e.museum_id, e.title, e.subtitle, e.introduction,
          e.status, e.theme_id, e.theme_version, e.curation_version,
          e.published_at, e.archived_at, e.created_at, e.updated_at
        from public.exhibitions e
        where e.museum_id = v_museum.id
      ) item
    ),
    'rooms', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
      from (
        select
          r.id, r.exhibition_id, r.museum_id, r.name, r.subtitle,
          r.introduction, r.sort_order, r.room_style
        from public.exhibition_rooms r
        where r.museum_id = v_museum.id
      ) item
    ),
    'placements', (
      select coalesce(
        jsonb_agg(
          to_jsonb(item)
          order by item.room_id, item.sort_order, item.artwork_id
        ),
        '[]'::jsonb
      )
      from (
        select
          ra.room_id, ra.artwork_id, ra.museum_id,
          ra.sort_order, ra.display_config
        from public.room_artworks ra
        where ra.museum_id = v_museum.id
      ) item
    ),
    'exhibitionSuggestions', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
      from (
        select
          s.id, s.exhibition_id, s.museum_id, s.suggestion_type,
          s.target_room_order, s.input_version, s.content, s.status,
          s.provider_request_id, s.created_at, s.reviewed_at
        from public.exhibition_ai_suggestions s
        where s.museum_id = v_museum.id
      ) item
    ),
    'invitations', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
      from (
        select
          i.id, i.museum_id, i.label, i.expires_at,
          i.revoked_at, i.created_at
        from public.invitations i
        where i.museum_id = v_museum.id
      ) item
    ),
    'visitorSessions', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
      from (
        select
          s.id, s.invitation_id, s.expires_at, s.revoked_at,
          s.last_seen_at, s.created_at
        from public.visitor_sessions s
        join public.invitations i on i.id = s.invitation_id
        where i.museum_id = v_museum.id
      ) item
    ),
    'auditEvents', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
      from (
        select
          e.id, e.museum_id, e.actor_id, e.event_type,
          e.entity_type, e.entity_id, e.metadata, e.created_at
        from public.audit_events e
        where e.museum_id = v_museum.id
      ) item
    )
  );
end;
$$;

revoke all on function public.export_museum_backup_metadata()
from public, anon;
grant execute on function public.export_museum_backup_metadata()
to authenticated;
