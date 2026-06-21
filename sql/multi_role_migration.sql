-- Multi-role migration: add roles array to public.users
-- Run this BEFORE deploying the new backend gate checks.
-- Step 1: Add column WITHOUT default (so all existing rows are NULL and get backfilled)
ALTER TABLE IF EXISTS public.users ADD COLUMN IF NOT EXISTS roles TEXT[];

-- Step 2: Backfill ALL existing rows with their current single role
-- This ensures existing organizers get {"organizer"} and explorers get {"user"}
UPDATE public.users SET roles = ARRAY[role] WHERE roles IS NULL;

-- Step 3: Verify backfill — should return 0 rows
-- SELECT COUNT(*) FROM public.users WHERE roles IS NULL;

-- Step 4: Set default for future inserts
ALTER TABLE IF EXISTS public.users ALTER COLUMN roles SET DEFAULT '{"user"}';

-- Step 5: Verify — show all users with their new roles
-- SELECT id, email, role, roles FROM public.users ORDER BY id;