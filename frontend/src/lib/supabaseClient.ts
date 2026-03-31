import { createClient } from "@supabase/supabase-js";

// Browser-safe Supabase client (anon JWT or publishable key).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabasePublishableKey = import.meta.env
  .VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const supabaseKey = (supabaseAnonKey || supabasePublishableKey)?.trim();

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "[Supabase] Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY) in .env."
  );
} else if (supabaseAnonKey) {
  try {
    const b64 = supabaseAnonKey.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (b64) {
      const payload = JSON.parse(atob(b64)) as { role?: string };
      if (payload.role === "service_role") {
        console.error(
          "[Supabase] VITE_SUPABASE_ANON_KEY must be the anon public key from Dashboard → API, not the service_role secret."
        );
      }
    }
  } catch {
    /* ignore */
  }
}

export const supabase = createClient(supabaseUrl ?? "", supabaseKey ?? "");

