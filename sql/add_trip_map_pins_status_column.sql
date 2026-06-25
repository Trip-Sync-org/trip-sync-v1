-- Add status column to trip_map_pins if it doesn't exist
-- This enables organizer auto-approval: pins with status='approved' are included in route building
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'trip_map_pins' and column_name = 'status'
  ) then
    alter table public.trip_map_pins
      add column status text not null default 'pending'
      check (status in ('pending', 'approved', 'denied'));
  end if;
end $$;

-- Index for efficient lookup of approved pins
create index if not exists idx_trip_map_pins_status
  on public.trip_map_pins (trip_id, status);