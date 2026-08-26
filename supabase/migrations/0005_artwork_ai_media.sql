delete from public.artwork_notes n
using public.artwork_notes newer
where n.artwork_id = newer.artwork_id
  and n.source = newer.source
  and (
    n.updated_at < newer.updated_at
    or (n.updated_at = newer.updated_at and n.id < newer.id)
  );

alter table public.artwork_notes
add constraint artwork_notes_artwork_source_unique unique (artwork_id, source);

create index if not exists ai_suggestions_artwork_status_idx
on public.ai_suggestions (artwork_id, status, input_version);

create or replace function public.bump_artwork_source_version(p_artwork_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_version integer;
begin
  if not exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = p_artwork_id
      and m.owner_id = auth.uid()
  ) then
    raise exception 'ARTWORK_NOT_FOUND';
  end if;

  update public.ai_suggestions
  set status = 'stale',
      reviewed_at = coalesce(reviewed_at, now())
  where artwork_id = p_artwork_id
    and status = 'pending';

  update public.artworks
  set source_version = source_version + 1
  where id = p_artwork_id
  returning source_version into v_source_version;

  return v_source_version;
end;
$$;
