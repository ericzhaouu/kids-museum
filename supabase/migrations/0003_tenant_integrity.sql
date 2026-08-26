-- Remove unsafe legacy links before making the ownership invariants mandatory.
delete from public.room_artworks ra
using public.exhibition_rooms r, public.exhibitions e, public.artworks a
where r.id = ra.room_id
  and e.id = r.exhibition_id
  and a.id = ra.artwork_id
  and e.museum_id <> a.museum_id;

delete from public.artwork_assets aa
using public.artworks a
where a.id = aa.artwork_id
  and (
    left(
      aa.storage_path,
      char_length(a.museum_id::text || '/' || a.id::text || '/')
    ) <> a.museum_id::text || '/' || a.id::text || '/'
    or char_length(aa.storage_path) <=
      char_length(a.museum_id::text || '/' || a.id::text || '/')
  );

update public.exhibitions e
set status = 'draft', published_at = null
where e.status = 'published'
  and exists (
    select 1
    from public.exhibition_rooms r
    join public.room_artworks ra on ra.room_id = r.id
    join public.artworks a on a.id = ra.artwork_id
    where r.exhibition_id = e.id
      and a.status <> 'published'
  );

alter table public.artworks
add constraint artworks_id_museum_unique unique (id, museum_id);

alter table public.exhibitions
add constraint exhibitions_id_museum_unique unique (id, museum_id);

alter table public.exhibition_rooms
drop constraint exhibition_rooms_exhibition_id_fkey;

alter table public.exhibition_rooms
add column museum_id uuid;

update public.exhibition_rooms r
set museum_id = e.museum_id
from public.exhibitions e
where e.id = r.exhibition_id;

alter table public.exhibition_rooms
alter column museum_id set not null,
add constraint exhibition_rooms_exhibition_museum_fk
  foreign key (exhibition_id, museum_id)
  references public.exhibitions (id, museum_id)
  on delete cascade,
add constraint exhibition_rooms_id_museum_unique unique (id, museum_id);

alter table public.room_artworks
drop constraint room_artworks_room_id_fkey,
drop constraint room_artworks_artwork_id_fkey;

alter table public.room_artworks
add column museum_id uuid;

update public.room_artworks ra
set museum_id = r.museum_id
from public.exhibition_rooms r
where r.id = ra.room_id;

alter table public.room_artworks
alter column museum_id set not null,
add constraint room_artworks_room_museum_fk
  foreign key (room_id, museum_id)
  references public.exhibition_rooms (id, museum_id)
  on delete cascade,
add constraint room_artworks_artwork_museum_fk
  foreign key (artwork_id, museum_id)
  references public.artworks (id, museum_id)
  on delete cascade;

create or replace function public.enforce_exhibition_room_museum()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_museum_id uuid;
begin
  select e.museum_id
  into v_museum_id
  from public.exhibitions e
  where e.id = new.exhibition_id
  for update;

  if v_museum_id is null then
    raise exception 'EXHIBITION_NOT_FOUND';
  end if;
  if new.museum_id is not null and new.museum_id <> v_museum_id then
    raise exception 'CROSS_MUSEUM_EXHIBITION_ROOM';
  end if;

  new.museum_id := v_museum_id;
  return new;
end;
$$;

drop trigger if exists exhibition_rooms_enforce_museum on public.exhibition_rooms;
create trigger exhibition_rooms_enforce_museum
before insert or update of exhibition_id, museum_id on public.exhibition_rooms
for each row execute procedure public.enforce_exhibition_room_museum();

create or replace function public.enforce_room_artwork_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exhibition_museum_id uuid;
  v_exhibition_status public.exhibition_status;
  v_artwork_museum_id uuid;
  v_artwork_status public.artwork_status;
begin
  select e.museum_id, e.status
  into v_exhibition_museum_id, v_exhibition_status
  from public.exhibition_rooms r
  join public.exhibitions e on e.id = r.exhibition_id
  where r.id = new.room_id
  for update of e;

  select a.museum_id, a.status
  into v_artwork_museum_id, v_artwork_status
  from public.artworks a
  where a.id = new.artwork_id
  for update;

  if v_exhibition_museum_id is null or v_artwork_museum_id is null then
    raise exception 'ROOM_OR_ARTWORK_NOT_FOUND';
  end if;
  if v_exhibition_museum_id <> v_artwork_museum_id then
    raise exception 'CROSS_MUSEUM_ROOM_ARTWORK';
  end if;
  if new.museum_id is not null and new.museum_id <> v_exhibition_museum_id then
    raise exception 'CROSS_MUSEUM_ROOM_ARTWORK';
  end if;
  if v_exhibition_status = 'published' and v_artwork_status <> 'published' then
    raise exception 'PUBLISHED_EXHIBITION_REQUIRES_PUBLISHED_ARTWORK';
  end if;

  new.museum_id := v_exhibition_museum_id;
  return new;
end;
$$;

drop trigger if exists room_artworks_enforce_integrity on public.room_artworks;
create trigger room_artworks_enforce_integrity
before insert or update of room_id, artwork_id, museum_id on public.room_artworks
for each row execute procedure public.enforce_room_artwork_integrity();

create or replace function public.enforce_artwork_asset_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_museum_id uuid;
  v_prefix text;
begin
  select a.museum_id
  into v_museum_id
  from public.artworks a
  where a.id = new.artwork_id
  for update;

  if v_museum_id is null then
    raise exception 'ARTWORK_NOT_FOUND';
  end if;

  v_prefix := v_museum_id::text || '/' || new.artwork_id::text || '/';
  if left(new.storage_path, char_length(v_prefix)) <> v_prefix
     or char_length(new.storage_path) <= char_length(v_prefix) then
    raise exception 'INVALID_ARTWORK_ASSET_PATH';
  end if;

  return new;
end;
$$;

drop trigger if exists artwork_assets_enforce_path on public.artwork_assets;
create trigger artwork_assets_enforce_path
before insert or update of artwork_id, storage_path on public.artwork_assets
for each row execute procedure public.enforce_artwork_asset_path();

create or replace function public.enforce_exhibition_contents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.exhibition_rooms r
  join public.room_artworks ra on ra.room_id = r.id
  join public.artworks a on a.id = ra.artwork_id
  where r.exhibition_id = new.id
  order by a.id
  for update of a;

  if exists (
    select 1
    from public.exhibition_rooms r
    join public.room_artworks ra on ra.room_id = r.id
    join public.artworks a on a.id = ra.artwork_id
    where r.exhibition_id = new.id
      and a.museum_id <> new.museum_id
  ) then
    raise exception 'CROSS_MUSEUM_ROOM_ARTWORK';
  end if;

  if new.status = 'published' and exists (
    select 1
    from public.exhibition_rooms r
    join public.room_artworks ra on ra.room_id = r.id
    join public.artworks a on a.id = ra.artwork_id
    where r.exhibition_id = new.id
      and a.status <> 'published'
  ) then
    raise exception 'PUBLISHED_EXHIBITION_REQUIRES_PUBLISHED_ARTWORK';
  end if;

  return new;
end;
$$;

drop trigger if exists exhibitions_enforce_contents on public.exhibitions;
create trigger exhibitions_enforce_contents
before insert or update of museum_id, status on public.exhibitions
for each row execute procedure public.enforce_exhibition_contents();

create or replace function public.enforce_exhibition_room_contents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_museum_id uuid;
  v_status public.exhibition_status;
begin
  select e.museum_id, e.status
  into v_museum_id, v_status
  from public.exhibitions e
  where e.id = new.exhibition_id
  for update;

  perform 1
  from public.room_artworks ra
  join public.artworks a on a.id = ra.artwork_id
  where ra.room_id = new.id
  order by a.id
  for update of a;

  if exists (
    select 1
    from public.room_artworks ra
    join public.artworks a on a.id = ra.artwork_id
    where ra.room_id = new.id
      and (
        a.museum_id <> v_museum_id
        or (v_status = 'published' and a.status <> 'published')
      )
  ) then
    raise exception 'INVALID_EXHIBITION_ROOM_CONTENTS';
  end if;

  return new;
end;
$$;

drop trigger if exists exhibition_rooms_enforce_contents on public.exhibition_rooms;
create trigger exhibition_rooms_enforce_contents
before update of exhibition_id on public.exhibition_rooms
for each row execute procedure public.enforce_exhibition_room_contents();

create or replace function public.enforce_artwork_exhibition_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
begin
  perform 1
  from public.room_artworks ra
  join public.exhibition_rooms r on r.id = ra.room_id
  join public.exhibitions e on e.id = r.exhibition_id
  where ra.artwork_id = new.id
  order by e.id
  for update of e;

  if exists (
    select 1
    from public.room_artworks ra
    join public.exhibition_rooms r on r.id = ra.room_id
    join public.exhibitions e on e.id = r.exhibition_id
    where ra.artwork_id = new.id
      and (
        e.museum_id <> new.museum_id
        or (e.status = 'published' and new.status <> 'published')
      )
  ) then
    raise exception 'ARTWORK_USED_BY_INCOMPATIBLE_EXHIBITION';
  end if;

  v_prefix := new.museum_id::text || '/' || new.id::text || '/';
  if exists (
    select 1
    from public.artwork_assets aa
    where aa.artwork_id = new.id
      and (
        left(aa.storage_path, char_length(v_prefix)) <> v_prefix
        or char_length(aa.storage_path) <= char_length(v_prefix)
      )
  ) then
    raise exception 'ARTWORK_HAS_INCOMPATIBLE_ASSET_PATH';
  end if;

  return new;
end;
$$;

drop trigger if exists artworks_enforce_exhibition_integrity on public.artworks;
create trigger artworks_enforce_exhibition_integrity
before update of museum_id, status on public.artworks
for each row execute procedure public.enforce_artwork_exhibition_integrity();

create index if not exists room_artworks_artwork_idx
on public.room_artworks (artwork_id);

drop policy if exists "owners manage room artworks" on public.room_artworks;
create policy "owners manage room artworks"
on public.room_artworks for all
using (
  exists (
    select 1
    from public.exhibition_rooms r
    join public.exhibitions e on e.id = r.exhibition_id
    join public.artworks a on a.id = room_artworks.artwork_id
    join public.museum_profiles m on m.id = e.museum_id
    where r.id = room_artworks.room_id
      and room_artworks.museum_id = e.museum_id
      and a.museum_id = e.museum_id
      and m.owner_id = auth.uid()
      and (e.status <> 'published' or a.status = 'published')
  )
)
with check (
  exists (
    select 1
    from public.exhibition_rooms r
    join public.exhibitions e on e.id = r.exhibition_id
    join public.artworks a on a.id = room_artworks.artwork_id
    join public.museum_profiles m on m.id = e.museum_id
    where r.id = room_artworks.room_id
      and room_artworks.museum_id = e.museum_id
      and a.museum_id = e.museum_id
      and m.owner_id = auth.uid()
      and (e.status <> 'published' or a.status = 'published')
  )
);

drop policy if exists "owners manage artwork assets" on public.artwork_assets;
create policy "owners manage artwork assets"
on public.artwork_assets for all
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
)
with check (
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

drop policy if exists "owners read private museum objects" on storage.objects;
create policy "owners read private museum objects"
on storage.objects for select
using (
  bucket_id = 'museum-private'
  and exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.museum_id::text = (storage.foldername(name))[1]
      and a.id::text = (storage.foldername(name))[2]
      and m.owner_id = auth.uid()
  )
);

drop policy if exists "owners upload private museum objects" on storage.objects;
create policy "owners upload private museum objects"
on storage.objects for insert
with check (
  bucket_id = 'museum-private'
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
  and exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.museum_id::text = (storage.foldername(name))[1]
      and a.id::text = (storage.foldername(name))[2]
      and m.owner_id = auth.uid()
  )
);
