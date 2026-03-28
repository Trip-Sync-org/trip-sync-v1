-- Fix: "new row violates row-level security policy for table organizer_coupons"
--
-- Preferred fix: In your project `.env`, set SUPABASE_SERVICE_ROLE_KEY to the
-- **service_role** secret from Supabase Dashboard → Settings → API (long JWT).
-- Do not use the "anon" / "public" key — that key is subject to RLS and will fail inserts.
-- Restart `npm run dev` after changing .env.
--
-- Optional (only if the table is never written from browser/anon client):
-- This disables RLS on this table so inserts work even if the server key was misconfigured.
-- For production, prefer the service_role key instead of leaving RLS off.

ALTER TABLE public.organizer_coupons DISABLE ROW LEVEL SECURITY;
