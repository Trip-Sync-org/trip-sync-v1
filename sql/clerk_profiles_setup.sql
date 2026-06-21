-- Clerk + Supabase profiles table setup
-- Run this in your Supabase SQL editor

-- 1. Add a clerk_id column to the existing profiles table (which uses bigint PK)
ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE;

-- 2. Create index for Clerk ID lookups
CREATE INDEX IF NOT EXISTS idx_profiles_clerk_id ON public.profiles (clerk_id);

-- 3. RLS policies using the Clerk JWT sub claim
--    The Clerk user ID is in request.jwt.claims->>'sub'

CREATE OR REPLACE FUNCTION public.get_clerk_user_id()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT current_setting('request.jwt.claims', true)::json->>'sub';
$$;

-- Policy: users can read their own profile
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
  ON public.profiles
  FOR SELECT
  USING (clerk_id = public.get_clerk_user_id());

-- Policy: users can update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (clerk_id = public.get_clerk_user_id())
  WITH CHECK (clerk_id = public.get_clerk_user_id());

-- Policy: allow profile creation during signup (backend API route writes the row)
DROP POLICY IF EXISTS "Allow profile creation during signup" ON public.profiles;
CREATE POLICY "Allow profile creation during signup"
  ON public.profiles
  FOR INSERT
  WITH CHECK (true);

-- 4. Upsert function for the backend sync endpoint
CREATE OR REPLACE FUNCTION public.upsert_profile_by_clerk_id(
  p_clerk_id TEXT,
  p_email TEXT,
  p_name TEXT,
  p_role TEXT
) RETURNS public.profiles
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_id BIGINT;
  v_new_row public.profiles;
BEGIN
  -- Try to find existing profile by clerk_id
  SELECT id INTO v_existing_id FROM public.profiles WHERE clerk_id = p_clerk_id LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Update existing
    UPDATE public.profiles
    SET email = p_email, name = p_name, role = p_role, updated_at = NOW()
    WHERE id = v_existing_id
    RETURNING * INTO v_new_row;
  ELSE
    -- Insert new (id is auto-generated bigint)
    INSERT INTO public.profiles (clerk_id, email, name, role)
    VALUES (p_clerk_id, p_email, p_name, p_role)
    RETURNING * INTO v_new_row;
  END IF;

  RETURN v_new_row;
END;
$$;