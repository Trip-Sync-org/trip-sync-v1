-- Add media JSONB column to nearby_attractions for R2 upload results
-- This stores [{ url, type: 'image'|'video', thumbnailUrl? }]
-- Run in Supabase SQL editor.

alter table if exists public.nearby_attractions
  add column if not exists media jsonb default '[]'::jsonb;

-- No need to drop the old images TEXT[] column — keep it for backward compat