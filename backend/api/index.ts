// backend/api/index.ts
// Vercel serverless catch-all handler.
// Vercel Root Directory = "backend", so this is deployed at /api/index.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getServerApp } from "../server.impl.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const app = await getServerApp();
    return app(req, res);
  } catch (err: any) {
    console.error("[vercel] handler error:", err?.message || err);
    return res.status(503).json({
      ok: false,
      service: "trip-sync",
      error: err?.message || "Server initialization failed",
      hint: "Check Vercel Function logs for missing env vars or module errors.",
    });
  }
}
