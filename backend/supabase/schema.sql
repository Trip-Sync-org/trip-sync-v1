-- =============================================================================
-- VOICE CHANNEL SCHEMA
-- Run this ONCE in your Supabase project → SQL Editor → New query → Run
-- supabase.com → your project → SQL Editor
-- This file is NOT executed by the app — run it manually in the Supabase dashboard.
-- =============================================================================

-- Trip members table: stores roles and blocked status
create table if not exists trip_members (
  id           uuid        default gen_random_uuid() primary key,
  trip_id      text        not null,
  user_id      text        not null,
  display_name text,
  role         text        not null default 'member'
                           check (role in ('organizer','co_admin','moderator','member')),
  is_blocked   boolean     not null default false,
  is_muted     boolean     not null default false,
  joined_at    timestamptz default now(),
  updated_at   timestamptz default now(),
  unique(trip_id, user_id)
);

-- Trip voice state: active talk mode per trip
create table if not exists trip_voice_state (
  trip_id      text        primary key,
  active_mode  text        not null default 'all'
                           check (active_mode in ('all','staff')),
  updated_at   timestamptz default now(),
  updated_by   text
);

-- Auto-update updated_at timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trip_members_updated_at on trip_members;
create trigger trip_members_updated_at
  before update on trip_members
  for each row execute function update_updated_at();

drop trigger if exists trip_voice_state_updated_at on trip_voice_state;
create trigger trip_voice_state_updated_at
  before update on trip_voice_state
  for each row execute function update_updated_at();

-- Indexes for fast lookups
create index if not exists idx_trip_members_trip_id on trip_members(trip_id);
create index if not exists idx_trip_members_user_id on trip_members(user_id);

-- Row Level Security (enable but allow service_role to bypass)
alter table trip_members enable row level security;
alter table trip_voice_state enable row level security;

-- Service role has full access (backend uses service_role key)
drop policy if exists "service_role_all_trip_members" on trip_members;
create policy "service_role_all_trip_members" on trip_members
  for all using (true);

drop policy if exists "service_role_all_trip_voice_state" on trip_voice_state;
create policy "service_role_all_trip_voice_state" on trip_voice_state
  for all using (true);

-- =============================================================================
-- HOW TO GET YOUR KEYS:
-- 1. Go to supabase.com and create a free project (takes ~2 min)
-- 2. Go to Project Settings → API
-- 3. Copy: Project URL, anon key, service_role key
-- 4. Add them to backend/.env.local
-- =============================================================================
