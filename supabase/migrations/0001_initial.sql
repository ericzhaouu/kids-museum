create extension if not exists pgcrypto;

create type public.artwork_status as enum ('draft', 'published', 'archived');
create type public.exhibition_status as enum ('draft', 'published', 'archived');
create type public.asset_kind as enum ('original', 'display', 'thumbnail', 'audio');
create type public.note_source as enum ('child', 'parent', 'transcript');
create type public.suggestion_status as enum ('pending', 'accepted', 'rejected', 'stale');

create table public.museum_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  artist_nickname text not null check (char_length(artist_nickname) between 1 and 40),
  theme_id text not null default 'warm-gallery',
  theme_version integer not null default 1 check (theme_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id)
);

create table public.artworks (
  id uuid primary key default gen_random_uuid(),
  museum_id uuid not null references public.museum_profiles(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 80),
  description text not null default '' check (char_length(description) <= 1000),
  status public.artwork_status not null default 'draft',
  created_on date,
  age_label text not null default '' check (char_length(age_label) <= 40),
  medium text not null default '' check (char_length(medium) <= 80),
  source_version integer not null default 1 check (source_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.artwork_assets (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  kind public.asset_kind not null,
  storage_path text not null check (storage_path !~ '(^|/)\\.\\.(/|$)'),
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  duration_seconds numeric check (
    duration_seconds is null or duration_seconds between 0 and 600
  ),
  created_at timestamptz not null default now(),
  unique (artwork_id, kind)
);

create table public.artwork_notes (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  source public.note_source not null,
  content text not null check (char_length(content) between 1 and 2000),
  is_ai_input boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  suggestion_type text not null check (
    suggestion_type in ('title', 'description', 'tags', 'transcript', 'curator_note')
  ),
  input_version integer not null check (input_version > 0),
  content jsonb not null,
  status public.suggestion_status not null default 'pending',
  provider_request_id text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  museum_id uuid not null references public.museum_profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  unique (museum_id, name)
);

create table public.artwork_tags (
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (artwork_id, tag_id)
);

create table public.exhibitions (
  id uuid primary key default gen_random_uuid(),
  museum_id uuid not null references public.museum_profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  subtitle text not null default '' check (char_length(subtitle) <= 150),
  introduction text not null default '' check (char_length(introduction) <= 2000),
  status public.exhibition_status not null default 'draft',
  theme_id text not null default 'warm-gallery',
  theme_version integer not null default 1 check (theme_version > 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.exhibition_rooms (
  id uuid primary key default gen_random_uuid(),
  exhibition_id uuid not null references public.exhibitions(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  introduction text not null default '' check (char_length(introduction) <= 1000),
  sort_order integer not null check (sort_order >= 0),
  room_style jsonb not null default '{}'::jsonb,
  unique (exhibition_id, sort_order)
);

create table public.room_artworks (
  room_id uuid not null references public.exhibition_rooms(id) on delete cascade,
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  sort_order integer not null check (sort_order >= 0),
  display_config jsonb not null default '{}'::jsonb,
  primary key (room_id, artwork_id),
  unique (room_id, sort_order)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  museum_id uuid not null references public.museum_profiles(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 43),
  label text not null default '' check (char_length(label) <= 80),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.visitor_sessions (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.invitations(id) on delete cascade,
  session_hash text not null unique check (char_length(session_hash) = 43),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  museum_id uuid not null references public.museum_profiles(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 80),
  entity_type text not null check (char_length(entity_type) between 1 and 40),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger museum_profiles_set_updated_at
before update on public.museum_profiles
for each row execute procedure public.set_updated_at();

create trigger artworks_set_updated_at
before update on public.artworks
for each row execute procedure public.set_updated_at();

create trigger artwork_notes_set_updated_at
before update on public.artwork_notes
for each row execute procedure public.set_updated_at();

create trigger exhibitions_set_updated_at
before update on public.exhibitions
for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.museum_profiles (owner_id, name, artist_nickname)
  values (new.id, '兮爷的小小博物馆', '兮爷')
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

insert into public.museum_profiles (owner_id, name, artist_nickname)
select id, '兮爷的小小博物馆', '兮爷'
from auth.users
on conflict (owner_id) do nothing;

create index artworks_museum_status_idx on public.artworks (museum_id, status);
create index artwork_assets_artwork_idx on public.artwork_assets (artwork_id);
create index artwork_notes_artwork_idx on public.artwork_notes (artwork_id);
create index exhibitions_museum_status_idx on public.exhibitions (museum_id, status);
create index rooms_exhibition_order_idx on public.exhibition_rooms (exhibition_id, sort_order);
create index invitations_museum_idx on public.invitations (museum_id);
create index visitor_sessions_invitation_idx on public.visitor_sessions (invitation_id);

alter table public.museum_profiles enable row level security;
alter table public.artworks enable row level security;
alter table public.artwork_assets enable row level security;
alter table public.artwork_notes enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.tags enable row level security;
alter table public.artwork_tags enable row level security;
alter table public.exhibitions enable row level security;
alter table public.exhibition_rooms enable row level security;
alter table public.room_artworks enable row level security;
alter table public.invitations enable row level security;
alter table public.visitor_sessions enable row level security;
alter table public.audit_events enable row level security;

create policy "owners manage museum"
on public.museum_profiles for all
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "owners manage artworks"
on public.artworks for all
using (
  exists (
    select 1 from public.museum_profiles m
    where m.id = museum_id and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.museum_profiles m
    where m.id = museum_id and m.owner_id = auth.uid()
  )
);

create policy "owners manage artwork assets"
on public.artwork_assets for all
using (
  exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = artwork_id and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = artwork_id and m.owner_id = auth.uid()
  )
);

create policy "owners manage artwork notes"
on public.artwork_notes for all
using (
  exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = artwork_id and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = artwork_id and m.owner_id = auth.uid()
  )
);

create policy "owners manage ai suggestions"
on public.ai_suggestions for all
using (
  exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = artwork_id and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = artwork_id and m.owner_id = auth.uid()
  )
);

create policy "owners manage tags"
on public.tags for all
using (
  exists (
    select 1 from public.museum_profiles m
    where m.id = museum_id and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.museum_profiles m
    where m.id = museum_id and m.owner_id = auth.uid()
  )
);

create policy "owners manage artwork tags"
on public.artwork_tags for all
using (
  exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = artwork_id and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.artworks a
    join public.museum_profiles m on m.id = a.museum_id
    where a.id = artwork_id and m.owner_id = auth.uid()
  )
);

create policy "owners manage exhibitions"
on public.exhibitions for all
using (
  exists (
    select 1 from public.museum_profiles m
    where m.id = museum_id and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.museum_profiles m
    where m.id = museum_id and m.owner_id = auth.uid()
  )
);

create policy "owners manage exhibition rooms"
on public.exhibition_rooms for all
using (
  exists (
    select 1
    from public.exhibitions e
    join public.museum_profiles m on m.id = e.museum_id
    where e.id = exhibition_id and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.exhibitions e
    join public.museum_profiles m on m.id = e.museum_id
    where e.id = exhibition_id and m.owner_id = auth.uid()
  )
);

create policy "owners manage room artworks"
on public.room_artworks for all
using (
  exists (
    select 1
    from public.exhibition_rooms r
    join public.exhibitions e on e.id = r.exhibition_id
    join public.museum_profiles m on m.id = e.museum_id
    where r.id = room_id and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.exhibition_rooms r
    join public.exhibitions e on e.id = r.exhibition_id
    join public.museum_profiles m on m.id = e.museum_id
    where r.id = room_id and m.owner_id = auth.uid()
  )
);

create policy "owners manage invitations"
on public.invitations for all
using (
  exists (
    select 1 from public.museum_profiles m
    where m.id = museum_id and m.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.museum_profiles m
    where m.id = museum_id and m.owner_id = auth.uid()
  )
);

create policy "owners inspect visitor sessions"
on public.visitor_sessions for select
using (
  exists (
    select 1
    from public.invitations i
    join public.museum_profiles m on m.id = i.museum_id
    where i.id = invitation_id and m.owner_id = auth.uid()
  )
);

create policy "owners inspect audit events"
on public.audit_events for select
using (
  exists (
    select 1 from public.museum_profiles m
    where m.id = museum_id and m.owner_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'museum-private',
  'museum-private',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mpeg', 'audio/mp4']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "owners read private museum objects"
on storage.objects for select
using (
  bucket_id = 'museum-private'
  and exists (
    select 1 from public.museum_profiles m
    where m.id::text = (storage.foldername(name))[1]
      and m.owner_id = auth.uid()
  )
);

create policy "owners upload private museum objects"
on storage.objects for insert
with check (
  bucket_id = 'museum-private'
  and exists (
    select 1 from public.museum_profiles m
    where m.id::text = (storage.foldername(name))[1]
      and m.owner_id = auth.uid()
  )
);

create policy "owners update private museum objects"
on storage.objects for update
using (
  bucket_id = 'museum-private'
  and exists (
    select 1 from public.museum_profiles m
    where m.id::text = (storage.foldername(name))[1]
      and m.owner_id = auth.uid()
  )
)
with check (
  bucket_id = 'museum-private'
  and exists (
    select 1 from public.museum_profiles m
    where m.id::text = (storage.foldername(name))[1]
      and m.owner_id = auth.uid()
  )
);

create policy "owners delete private museum objects"
on storage.objects for delete
using (
  bucket_id = 'museum-private'
  and exists (
    select 1 from public.museum_profiles m
    where m.id::text = (storage.foldername(name))[1]
      and m.owner_id = auth.uid()
  )
);
