import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client.
// IMPORTANT: This file must only be imported in server / backend code
// (e.g. Express routes, server-side scripts, Cloud Functions).
//
// We read env vars inside the factory so dotenv.config() in server.ts
// has already executed before we access them.

export const createSupabaseServerClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL as string | undefined;
  const supabaseServiceRoleKey = process.env
    .SUPABASE_SERVICE_ROLE_KEY as string | undefined;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "[Supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. Check your .env in tripsync-main."
    );
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

