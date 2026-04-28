// backend/api/health.ts
// Standalone Vercel serverless function for health check.
// Root Directory in Vercel is set to "backend", so this file is at /api/health.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const cashfreeAppId = (process.env.CASHFREE_APP_ID ?? "").trim();
  const cashfreeSecretKey = (process.env.CASHFREE_SECRET_KEY ?? "").trim();

  const supabaseEnvOk = Boolean(supabaseUrl && supabaseKey);
  const paymentsReady = Boolean(cashfreeAppId && cashfreeSecretKey);

  let supabaseReady = false;
  let supabaseError: string | undefined;

  if (supabaseEnvOk) {
    try {
      const client = createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await client.from("users").select("id").limit(1);
      if (error) {
        supabaseError = error.message;
        supabaseReady = !/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(error.message);
      } else {
        supabaseReady = true;
      }
    } catch (e: any) {
      supabaseError = e?.message ?? String(e);
      supabaseReady = false;
    }
  } else {
    supabaseError = "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var is missing in Vercel project settings";
  }

  return res.status(200).json({
    ok: true,
    service: "trip-sync",
    api: "vercel-serverless",
    supabase_ready: supabaseReady,
    supabase_error: supabaseError,
    payments_ready: paymentsReady,
    payments_hint: paymentsReady
      ? "Cashfree checkout enabled"
      : "Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY in Vercel env vars to enable payments.",
    ts: new Date().toISOString(),
  });
}
