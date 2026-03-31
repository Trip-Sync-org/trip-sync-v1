import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getServerApp } from "../server";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await getServerApp();
  return app(req, res);
}

