-- Trip-Sync: ordered trip checkpoints, map pin approval queue, and nearby_attractions extensions.
-- Run in Supabase SQL Editor after `trips` and `users` exist. Uses bigint trip_id / user ids (matches app).

-- ─── trip_checkpoints ─────────────────────────────────────────────────────────
create table if not exists public.trip_checkpoints (
  id uuid primary key default gen_random_uuid(),
  trip_id bigint not null references public.trips (id) on delete cascade,
  source text not null check (source in ('manual', 'nearby_attraction', 'map_pin')),
  nearby_attraction_id uuid references public.nearby_attractions (id) on delete set null,
  name text not null,
  description text,
  latitude double precision not null,
  longitude double precision not null,
  order_index integer not null,
  created_by bigint references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_trip_checkpoints_trip_order
  on public.trip_checkpoints (trip_id, order_index asc);

alter table public.trip_checkpoints enable row level security;

-- Members can read checkpoints for trips they belong to; staff manage (enforced primarily via Express + service role).
create policy "trip_checkpoints_select_members"
  on public.trip_checkpoints for select
  using (true);

create policy "trip_checkpoints_staff_write"
  on public.trip_checkpoints for all
  using (true)
  with check (true);

-- ─── nearby_attractions extensions ────────────────────────────────────────────
alter table public.nearby_attractions
  add column if not exists images text[] not null default '{}';

alter table public.nearby_attractions
  add column if not exists trip_id bigint references public.trips (id) on delete set null;

-- ─── map_pin_requests ─────────────────────────────────────────────────────────
create table if not exists public.map_pin_requests (
  id uuid primary key default gen_random_uuid(),
  trip_id bigint not null references public.trips (id) on delete cascade,
  requested_by bigint not null references public.users (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  reviewed_by bigint references public.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_map_pin_requests_trip_status
  on public.map_pin_requests (trip_id, status, created_at desc);

alter table public.map_pin_requests enable row level security;

create policy "map_pin_requests_select_staff"
  on public.map_pin_requests for select
  using (true);

create policy "map_pin_requests_insert_members"
  on public.map_pin_requests for insert
  with check (true);

create policy "map_pin_requests_update_staff"
  on public.map_pin_requests for update
  using (true)
  with check (true);
