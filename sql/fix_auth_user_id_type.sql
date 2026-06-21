-- Fix auth_user_id column type: UUID → TEXT to accept Clerk user IDs (user_xxxxx)
-- Also adds clerk_id alias column for clarity

-- Step 1: Drop the DEFAULT if any (UUID columns often have gen_random_uuid())
ALTER TABLE IF EXISTS public.users ALTER COLUMN auth_user_id DROP DEFAULT;

-- Step 2: Cast the column type from UUID → TEXT
-- Requires dropping the default first
ALTER TABLE IF EXISTS public.users ALTER COLUMN auth_user_id TYPE TEXT USING auth_user_id::TEXT;

-- Step 3: Also ensure clerk_id TEXT column exists (for direct Clerk ID lookups)
ALTER TABLE IF EXISTS public.users ADD COLUMN IF NOT EXISTS clerk_id TEXT;

-- Step 4: Backfill clerk_id from auth_user_id where populated
UPDATE public.users SET clerk_id = auth_user_id WHERE clerk_id IS NULL AND auth_user_id IS NOT NULL;

-- Step 5: Make the sync function use clerk_id directly
-- (no server code change needed if we update the query to use clerk_id)