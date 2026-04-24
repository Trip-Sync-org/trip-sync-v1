-- Cashfree payment/payout support columns.
-- Run in Supabase SQL editor.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cashfree_order_id text NULL,
  ADD COLUMN IF NOT EXISTS cashfree_txn_id text NULL,
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS amount_paid numeric(10,2) NULL,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz NULL;

ALTER TABLE public.payout_requests
  ADD COLUMN IF NOT EXISTS cashfree_transfer_id text NULL;
