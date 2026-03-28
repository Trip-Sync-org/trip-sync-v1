import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").trim();
const anon = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

/**
 * Set when both URL and anon key exist (copy from root `.env`: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
 * into `mobile/.env` as `EXPO_PUBLIC_*`). Restart Expo after editing `.env`.
 */
export const supabase: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      })
    : null;

if (__DEV__ && !supabase) {
  console.warn(
    "[Trip-Sync] Supabase disabled: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in mobile/.env (see mobile/.env.example). Email login still uses the API.",
  );
}
