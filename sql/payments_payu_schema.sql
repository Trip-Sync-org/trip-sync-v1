-- PayU + organizer payouts — run in Supabase SQL Editor once.
-- Bookings: payment columns. Payout tables: details + requests.

-- ── Bookings: amounts & PayU metadata ─────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS final_amount NUMERIC(12, 2);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payu_txn_id TEXT;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS platform_fee_amount NUMERIC(12, 2);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS organizer_net_amount NUMERIC(12, 2);

-- Ensure payment_status can be pending / failed / paid (app already uses paid)
COMMENT ON COLUMN public.bookings.payment_status IS 'pending | paid | failed';

-- If `bookings.status` is constrained to values that exclude `pending`, either extend the CHECK
-- constraint or store awaiting-payment rows with status `confirmed` and rely on payment_status only.

-- ── Organizer payout bank/UPI details ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizer_payout_details (
  user_id BIGINT PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  payout_method TEXT NOT NULL CHECK (payout_method IN ('upi', 'bank')),
  upi_id TEXT,
  bank_account_name TEXT,
  bank_name TEXT,
  bank_account_number TEXT,
  bank_ifsc TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.organizer_payout_details DISABLE ROW LEVEL SECURITY;

-- ── Payout withdrawal requests (manual processing via PayU / bank) ─────────
CREATE TABLE IF NOT EXISTS public.payout_requests (
  id BIGSERIAL PRIMARY KEY,
  organizer_id BIGINT NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  trip_id BIGINT REFERENCES public.trips (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  net_amount NUMERIC(12, 2),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  payu_transfer_id TEXT,
  failure_reason TEXT,
  payout_method_snapshot TEXT
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_organizer_id ON public.payout_requests (organizer_id);

ALTER TABLE public.payout_requests DISABLE ROW LEVEL SECURITY;
