import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { getServerApp } = await import("../server.impl.js");
    const app = await getServerApp();
    return app(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[api/index] bootstrap failed:", message);
    return res.status(500).json({
      error: "Backend bootstrap failed",
      message,
      stack: process.env.NODE_ENV === "production" ? undefined : stack,
    });
  }
}

