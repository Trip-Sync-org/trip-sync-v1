-- =====================================================
-- Organizer Payout System Migration
-- Run this in Supabase SQL Editor
-- =====================================================

-- 1. organizer_bank_accounts — stores multiple bank accounts per organizer
-- Note: organizer_id is TEXT (not FK to users.id) to match existing pattern
CREATE TABLE IF NOT EXISTS public.organizer_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id TEXT NOT NULL,
  account_number TEXT NOT NULL,
  ifsc TEXT NOT NULL,
  bank_name TEXT DEFAULT '',
  account_holder_name TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.organizer_bank_accounts DISABLE ROW LEVEL SECURITY;

-- 2. organizer_wallet — running balance ledger per organizer
CREATE TABLE IF NOT EXISTS public.organizer_wallet (
  organizer_id TEXT PRIMARY KEY,
  total_earned NUMERIC DEFAULT 0,
  total_paid_out NUMERIC DEFAULT 0,
  pending_payout NUMERIC DEFAULT 0,
  platform_fee_deducted NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.organizer_wallet DISABLE ROW LEVEL SECURITY;

-- 3. wallet_ledger — every credit/debit event
CREATE TABLE IF NOT EXISTS public.wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('booking_credit', 'payout_debit', 'refund_debit', 'platform_fee')),
  booking_id BIGINT NULL,
  payout_request_id UUID NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.wallet_ledger DISABLE ROW LEVEL SECURITY;

-- 4. Extend payout_requests — add columns if missing (idempotent)
-- Note: payout_requests already has organizer_id as TEXT, no FK to users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_requests' AND column_name = 'bank_account_id') THEN
    ALTER TABLE public.payout_requests ADD COLUMN bank_account_id UUID NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_requests' AND column_name = 'utr') THEN
    ALTER TABLE public.payout_requests ADD COLUMN utr TEXT DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_requests' AND column_name = 'account_label') THEN
    ALTER TABLE public.payout_requests ADD COLUMN account_label TEXT DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payout_requests' AND column_name = 'note') THEN
    ALTER TABLE public.payout_requests ADD COLUMN note TEXT DEFAULT '';
  END IF;
END $$;

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_organizer_created ON public.wallet_ledger(organizer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_requests_organizer_status ON public.payout_requests(organizer_id, status);