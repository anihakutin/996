-- db.sql
CREATE TABLE IF NOT EXISTS live_users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  x_handle TEXT,
  photo_url TEXT,
  what_working_on TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  is_venue BOOLEAN DEFAULT FALSE,
  venue_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- remove stale presences (server will also do this)
CREATE INDEX IF NOT EXISTS live_users_updated_idx ON live_users (updated_at DESC);
CREATE INDEX IF NOT EXISTS live_users_geo_idx ON live_users (lat, lon);
CREATE INDEX IF NOT EXISTS live_users_x_handle_idx ON live_users (x_handle);
CREATE INDEX IF NOT EXISTS live_users_active_idx ON live_users (is_active);

-- Add is_active column to existing tables (if it doesn't exist)
ALTER TABLE live_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
