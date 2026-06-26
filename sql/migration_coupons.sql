-- Migration: Enhanced Coupon System
-- Adds trip_id, is_global to organizer_coupons
-- Creates coupon_user_assignments table for push notifications
-- Creates order mode for customized coupon codes

-- 1) Add trip_id and is_global to organizer_coupons
ALTER TABLE public.organizer_coupons
  ADD COLUMN IF NOT EXISTS trip_id BIGINT REFERENCES public.trips (id) ON DELETE SET NULL;

ALTER TABLE public.organizer_coupons
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_organizer_coupons_trip_id ON public.organizer_coupons (trip_id);
CREATE INDEX IF NOT EXISTS idx_organizer_coupons_active_code ON public.organizer_coupons (code, active);

-- 2) Create coupon_user_assignments table (for push/manual assignment)
CREATE TABLE IF NOT EXISTS public.coupon_user_assignments (
  id BIGSERIAL PRIMARY KEY,
  coupon_id BIGINT NOT NULL REFERENCES public.organizer_coupons (id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  trip_id BIGINT REFERENCES public.trips (id) ON DELETE SET NULL,
  redeemed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, user_id, trip_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_user_assignments_user ON public.coupon_user_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_coupon_user_assignments_coupon ON public.coupon_user_assignments (coupon_id);

ALTER TABLE public.coupon_user_assignments DISABLE ROW LEVEL SECURITY;

-- 3) Update the increment function to handle trip-scoped validation
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