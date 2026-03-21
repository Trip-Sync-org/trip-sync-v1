import { createClient } from "@supabase/supabase-js";

// Browser-safe Supabase client (uses anon/public key only).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env
  .VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[Supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. Check your .env."
  );
}

export const supabase = createClient(
  supabaseUrl ?? "",
  supabaseAnonKey ?? ""
);

