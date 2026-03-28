import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client.
// IMPORTANT: This file must only be imported in server / backend code
// (e.g. Express routes, server-side scripts, Cloud Functions).
//
// We read env vars inside the factory so dotenv.config() in server.ts
// has already executed before we access them.

function decodeJwtPayload(key: string): { role?: string; ref?: string } | null {
  const parts = key.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json) as { role?: string; ref?: string };
  } catch {
    return null;
  }
}

function projectRefFromSupabaseUrl(url: string): string | null {
  const m = url.trim().match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

function assertServiceRoleJwt(key: string) {
  const payload = decodeJwtPayload(key);
  if (!payload?.role) {
    throw new Error(
      "[Supabase] SUPABASE_SERVICE_ROLE_KEY must be a valid JWT from Dashboard → Settings → API (service_role). " +
        "Decoded token had no role claim — check for a copy/paste error or wrong key.",
    );
  }
  if (payload.role !== "service_role") {
    throw new Error(
      `[Supabase] SUPABASE_SERVICE_ROLE_KEY must be the service_role secret (JWT role must be "service_role"; got "${payload.role}"). ` +
        `The anon key triggers Row Level Security errors on server inserts. ` +
        `Copy the service_role key from Supabase Dashboard → Settings → API.`,
    );
  }
}

/** Service role JWT is tied to one project ref; URL must match or requests hit the wrong host. */
function assertUrlMatchesJwtRef(supabaseUrl: string, serviceRoleKey: string) {
  const urlRef = projectRefFromSupabaseUrl(supabaseUrl);
  const payload = decodeJwtPayload(serviceRoleKey);
  const jwtRef = payload?.ref?.toLowerCase();
  if (urlRef && jwtRef && urlRef !== jwtRef) {
    throw new Error(
      `[Supabase] SUPABASE_URL project ref "${urlRef}" does not match SUPABASE_SERVICE_ROLE_KEY ref "${jwtRef}". ` +
        `Copy both URL and service_role key from the same Supabase project (Settings → API). ` +
        `If you use a stale Windows environment variable, remove SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from System env or rely on .env with dotenv override.`
    );
  }
}

export const createSupabaseServerClient = () => {
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const supabaseServiceRoleKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  ).trim();

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "[Supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. Check your .env in tripsync-main."
    );
  }

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl)) {
    throw new Error(
      `[Supabase] SUPABASE_URL must look like https://YOUR_PROJECT_REF.supabase.co (got "${supabaseUrl.slice(0, 40)}…"). Fix the typo (e.g. missing "https").`
    );
  }

  assertServiceRoleJwt(supabaseServiceRoleKey);
  assertUrlMatchesJwtRef(supabaseUrl, supabaseServiceRoleKey);

  const ref = projectRefFromSupabaseUrl(supabaseUrl);
  if (ref) {
    console.log(`[Supabase] Server client: https://${ref}.supabase.co`);
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

