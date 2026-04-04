-- Live convoy: last known GPS per participant (REST + Socket.IO upsert)

CREATE TABLE IF NOT EXISTS trip_participant_locations (
  id         bigserial PRIMARY KEY,
  trip_id    bigint NOT NULL,
  user_id    bigint NOT NULL,
  lat        double precision NOT NULL DEFAULT 0,
  lng        double precision NOT NULL DEFAULT 0,
  speed_mps  double precision,
  updated_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_trip_participant_locations'
  ) THEN
    ALTER TABLE trip_participant_locations
      ADD CONSTRAINT uq_trip_participant_locations UNIQUE (trip_id, user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tpl_trip_id ON trip_participant_locations(trip_id);
