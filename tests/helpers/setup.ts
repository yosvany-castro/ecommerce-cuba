import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local for tests (covers integration + E2E credentials)
config({ path: resolve(process.cwd(), ".env.local") });

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL is required for tests; check .env.local");
}
