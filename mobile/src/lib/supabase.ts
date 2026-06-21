import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").trim();
const anon = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

/**
 * Set when both URL and anon key exist (copy from root `.env`: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
 * into `mobile/.env` as `EXPO_PUBLIC_*`). Restart Expo after editing `.env`.
 *
 * This client is used for database operations only (not auth).
 * Auth is handled by Clerk. The Clerk JWT is attached via the `accessToken` option
 * so that Supabase RLS policies can validate Clerk sessions.
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

/**
 * Returns a Supabase client that attaches the Clerk JWT as the access token.
 * Use this for authenticated database requests where RLS policies expect a Clerk token.
 *
 * @param getClerkJwt - A function that returns a Clerk JWT (e.g. from `useAuth().getToken({ template: "supabase" })`)
 */
export function getSupabaseWithClerkJwt(getClerkJwt: () => Promise<string | null>): SupabaseClient | null {
  if (!supabase) return null;
  return createClient(url, anon, {
    global: {
      headers: {
        // This is handled by Supabase's Clerk integration via the accessToken option
      },
    },
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    accessToken: async () => {
      const token = await getClerkJwt();
      return token ?? null;
    },
  });
}