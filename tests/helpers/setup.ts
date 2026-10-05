import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local for tests (covers integration + E2E credentials)
config({ path: resolve(process.cwd(), ".env.local") });

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL is required for tests; check .env.local");
}

// BLINDAJE (2026-10-05): .env.local trae AGGREGATOR_PROVIDER=multi y los
// tokens reales — los tests de integración llegaron a gastar el límite
// mensual de Apify. En tests: proveedor mock y SIN credenciales pagadas
// (una llamada real falla al instante y gratis). Opt-in explícito y
// consciente: ALLOW_PAID_APIS_IN_TESTS=1.
if (process.env.ALLOW_PAID_APIS_IN_TESTS !== "1") {
  process.env.AGGREGATOR_PROVIDER = "mock";
  process.env.MULTI_PROVIDER_SOURCES = "";
  for (const k of Object.keys(process.env)) {
    if (/APIFY|RAPIDAPI/i.test(k)) delete process.env[k];
  }
}
