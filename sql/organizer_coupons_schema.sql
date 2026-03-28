-- Run in Supabase SQL Editor (or psql) against your project.
-- Creates organizer coupons, optional booking columns, and an atomic usage increment.
--
-- If REFERENCES public.users (id) fails, check whether `users.id` is UUID; if so,
-- use organizer_id UUID NOT NULL REFERENCES public.users (id) and update server types accordingly.

-- 1) Organizer coupons (matches server.ts expectations)
CREATE TABLE IF NOT EXISTS public.organizer_coupons (
  id BIGSERIAL PRIMARY KEY,
  organizer_id BIGINT NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  discount_pct INTEGER NOT NULL CHECK (discount_pct >= 1 AND discount_pct <= 100),
  usage_limit INTEGER NOT NULL CHECK (usage_limit >= 1),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expiry_date DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organizer_id, code)
);

CREATE INDEX IF NOT EXISTS idx_organizer_coupons_organizer_id ON public.organizer_coupons (organizer_id);

-- 1b) RLS: Your Express API should use SUPABASE_SERVICE_ROLE_KEY (bypasses RLS). If inserts still fail
--     with "row-level security policy", run the line below so the table is not blocked by empty policies.
--     Also confirm .env has the service_role secret from Dashboard → Settings → API (not the anon key).
ALTER TABLE public.organizer_coupons DISABLE ROW LEVEL SECURITY;

-- Alternative (keep RLS on): use the service_role JWT in .env, or add policies for authenticated users
-- (see sql/fix_organizer_coupons_rls.sql comments).

-- 2) Optional: store which coupon was applied on a booking (server sends these when columns exist)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS coupon_id BIGINT REFERENCES public.organizer_coupons (id) ON DELETE SET NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2);

-- 3) Atomic increment under limit + expiry (used by server via RPC)
CREATE OR REPLACE FUNCTION public.increment_organizer_coupon_usage (p_coupon_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT;
BEGIN
  UPDATE public.organizer_coupons
  SET
    used_count = used_count + 1,
    updated_at = now()
  WHERE id = p_coupon_id
    AND active = true
    AND used_count < usage_limit
    AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_organizer_coupon_usage (BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_organizer_coupon_usage (BIGINT) TO service_role;
