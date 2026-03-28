-- Run in Supabase SQL editor. Stores rider-discovered places for reuse as checkpoints.

create table if not exists public.nearby_attractions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  lat double precision not null,
  lng double precision not null,
  created_by bigint references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists nearby_attractions_created_at_idx
  on public.nearby_attractions (created_at desc);

alter table public.nearby_attractions enable row level security;

-- Public read for app pickers; inserts via service role / backend only (Express uses service key).
create policy "nearby_attractions_select_all" on public.nearby_attractions
  for select using (true);
