/**
 * Backend entrypoint.
 * Loads repo-root `.env` before any other module — `server.impl` transitively imports
 * `lib/supabase.js`, which needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY at import time.
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(repoRoot, ".env"), override: true });
// Optional: secrets only in backend/.env (merged; does not override keys already set from root)
dotenv.config({ path: path.join(__dirname, ".env"), override: false });

const { startLocalServer } = await import("./server.impl.js");

startLocalServer().catch((error) => {
  console.error("Server bootstrap failed:", error);
  process.exit(1);
});
