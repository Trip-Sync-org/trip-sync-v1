/**
 * Backend entrypoint.
 * Uses backend-local implementation so this folder can deploy independently.
 */
import { startLocalServer } from "./server.impl";

startLocalServer().catch((error) => {
  console.error("Server bootstrap failed:", error);
  process.exit(1);
});

